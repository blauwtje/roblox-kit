import timers from "node:timers/promises";
import jpeg from "jpeg-js";
import { z } from "zod";
import { config } from "../src/config.ts";
import { applyLighting } from "../src/lighting/apply-lighting.ts";
import { runLuauFile } from "../src/luau/run-luau-file.ts";
import { buildMapTool } from "../src/map/build-map-tool.ts";
import { relationMapSpecSchema } from "../src/map/map-spec.ts";
import { loadPresets } from "../src/style/load-preset.ts";
import { selectStudio, type StudioConnection } from "../src/studio/studio-connection.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";

/**
 * `node scripts/measure-wall-color.ts [--studio=<studioId>] <preset>...` builds a one-room map in each preset's style far from
 * the place's Baseplate, looks straight at each of its four walls from close by, after the same
 * `config.captureSettleMs` wait capture_zones uses, and prints one JSON line per preset:
 * the preset's wall color, the median color of the wall in the captures and their luminance gap.
 * The map it builds is named `wall-color-<preset>` and is destroyed, with Lighting restored, afterwards;
 * no other map is touched. `--studio` is needed only while several Studios are connected.
 */
const roomCenter = { x: 6000, z: 6000 };
const roomSize = 40;
const wallHeight = 16;
/** Studs between the camera and the wall it faces: at the 70 degree field of view the frame then holds only wall. */
const cameraDistanceStuds = 8;
/** Share of the image width and height, centered, whose pixels are measured: keeps edges and trim out. */
const measuredShare = 0.4;
const wallDirections = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
];

const ceilingsChangedSchema = z.strictObject({ changed: z.number() });

type Rgb = [number, number, number];

/** jpeg-js decodes to RGBA by default. */
const bytesPerPixel = 4;

interface DecodedImage {
  width: number;
  height: number;
  /** RGBA pixels, `width * bytesPerPixel` bytes per row. */
  data: Uint8Array;
}

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Median color of the centered `measuredShare` of the image. */
function medianColorOf(image: DecodedImage): Rgb {
  const channels: number[][] = [[], [], []];
  const firstColumn = Math.floor(image.width * ((1 - measuredShare) / 2));
  const lastColumn = Math.ceil(image.width * ((1 + measuredShare) / 2));
  const firstRow = Math.floor(image.height * ((1 - measuredShare) / 2));
  const lastRow = Math.ceil(image.height * ((1 + measuredShare) / 2));
  for (let row = firstRow; row < lastRow; row += 1) {
    for (let column = firstColumn; column < lastColumn; column += 1) {
      const start = (row * image.width + column) * bytesPerPixel;
      for (const [channel, values] of channels.entries()) {
        values.push(image.data[start + channel] ?? 0);
      }
    }
  }
  return [median(channels[0] ?? []), median(channels[1] ?? []), median(channels[2] ?? [])];
}

/** Rec. 709 weights on the 0 to 255 channel values, so a gap reads on the same scale. */
function luminanceOf([red, green, blue]: Rgb): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function hexOf(color: Rgb): string {
  return `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function rgbOf(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

/** Hides the ceilings as capture_zones does; the map is destroyed afterwards, so they are never restored. */
function hideCeilings(connection: StudioConnection, studioId: string, mapId: string) {
  return runLuauFile({
    connection,
    studioId,
    fileName: "set-cutaway-hidden.luau",
    datamodelType: "Edit",
    arguments: {
      mapId,
      mapsFolderName: config.mapsFolderName,
      ceilingTag: config.ceilingTag,
      originalTransparencyAttribute: config.cutawayOriginalTransparencyAttribute,
      hidden: true,
      wallPrefixes: [],
    },
    resultSchema: ceilingsChangedSchema,
  });
}

/** Destroys the Model of `mapId` only; the maps folder stays unless that leaves it empty. */
function destroyMapLuau(mapId: string): string {
  return `
local mapsFolder = workspace:FindFirstChild("${config.mapsFolderName}")
if mapsFolder then
  local model = mapsFolder:FindFirstChild("${mapId}")
  if model then model:Destroy() end
  if #mapsFolder:GetChildren() == 0 then mapsFolder:Destroy() end
end
return "destroyed"`;
}

async function captureWall(
  connection: StudioConnection,
  studioId: string,
  mapId: string,
  direction: { x: number; z: number },
): Promise<DecodedImage> {
  const wallCenterHeight = wallHeight / 2;
  const half = roomSize / 2;
  await timers.setTimeout(config.captureSettleMs);
  const result = await connection.callTool({
    name: "screen_capture",
    studioId,
    arguments: {
      capture_id: `${mapId}-${String(direction.x)}-${String(direction.z)}`,
      camera_position: [
        roomCenter.x + direction.x * (half - cameraDistanceStuds),
        wallCenterHeight,
        roomCenter.z + direction.z * (half - cameraDistanceStuds),
      ],
      look_at_position: [
        roomCenter.x + direction.x * half,
        wallCenterHeight,
        roomCenter.z + direction.z * half,
      ],
    },
  });
  const image = result.content.find((block) => block.type === "image");
  if (result.isError === true || image === undefined) {
    throw new Error(`screen_capture of ${mapId} returned no image: ${textOf(result)}`);
  }
  try {
    return jpeg.decode(Buffer.from(image.data, "base64"), { useTArray: true });
  } catch (error) {
    throw new Error(`Capture of ${mapId} (${image.mimeType}) cannot be read: ${String(error)}`, {
      cause: error,
    });
  }
}

/** Builds the one-room map of `presetName`, measures its four walls and removes the map again. */
async function measurePreset(
  connection: StudioConnection,
  studioId: string,
  presetName: string,
  wallColor: string,
) {
  const mapId = `wall-color-${presetName}`;
  const spec = relationMapSpecSchema.parse({
    mapId,
    style: { preset: presetName },
    wallHeight,
    doorWidth: 10,
    rooms: [{ name: "room", x: roomCenter.x, z: roomCenter.z, width: roomSize, depth: roomSize }],
  });
  try {
    const built = await buildMapTool.handler(
      buildMapTool.inputSchema.parse({ ...spec, studioId }),
      { studio: connection },
    );
    if (built.isError === true) throw new Error(`build_map failed: ${textOf(built)}`);
    try {
      await hideCeilings(connection, studioId, mapId);
      const colors: Rgb[] = [];
      for (const direction of wallDirections) {
        colors.push(medianColorOf(await captureWall(connection, studioId, mapId, direction)));
      }
      const measured = [0, 1, 2].map(
        (channel) => colors.reduce((sum, color) => sum + (color[channel] ?? 0), 0) / colors.length,
      ) as Rgb;
      const wallLuminance = luminanceOf(rgbOf(wallColor));
      const measuredLuminance = luminanceOf(measured);
      return {
        preset: presetName,
        wallColor,
        measuredColor: hexOf(measured),
        wallLuminance: Math.round(wallLuminance * 10) / 10,
        measuredLuminance: Math.round(measuredLuminance * 10) / 10,
        luminanceGap: Math.round((measuredLuminance - wallLuminance) * 10) / 10,
      };
    } finally {
      // The snapshot lives on the map Model, so Lighting is restored before the Model is destroyed.
      await applyLighting({
        connection,
        studioId,
        mapsFolderName: config.mapsFolderName,
        mapId,
      });
    }
  } finally {
    await connection.callTool({
      name: "execute_luau",
      studioId,
      arguments: { code: destroyMapLuau(mapId), datamodel_type: "Edit" },
    });
  }
}

const studioFlag = "--studio=";
const argumentsGiven = process.argv.slice(2);
const requestedStudioId = argumentsGiven
  .find((argument) => argument.startsWith(studioFlag))
  ?.slice(studioFlag.length);
const presetNames = argumentsGiven.filter((argument) => !argument.startsWith(studioFlag));
if (presetNames.length === 0) {
  console.error("Usage: node scripts/measure-wall-color.ts [--studio=<studioId>] <preset>...");
  process.exit(1);
}
const presets = await loadPresets();
const connection = new StudioMcpClient({
  clientInfo: { name: `${config.serverName}-measure`, version: config.serverVersion },
  timeoutMs: config.upstreamTimeoutMs,
});
try {
  const studioId = await selectStudio(connection, requestedStudioId);
  for (const presetName of presetNames) {
    const preset = presets.get(presetName);
    if (preset === undefined) {
      throw new Error(`Unknown preset "${presetName}"; known: ${[...presets.keys()].join(", ")}.`);
    }
    const row = await measurePreset(connection, studioId, presetName, preset.surfaces.wall.color);
    console.log(JSON.stringify(row));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
}
