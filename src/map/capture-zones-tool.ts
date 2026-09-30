import timers from "node:timers/promises";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { config } from "../config.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio, type StudioConnection } from "../studio/studio-connection.ts";
import { wallBandNames } from "./room-details.ts";
import { nearWallSideOfView, zoneShots, type Bounds, type ViewedZoneShot } from "./zone-cameras.ts";

const zoneViewSchema = z.enum(["a", "b", "eye"]);
type ZoneView = z.output<typeof zoneViewSchema>;

const vectorSchema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const coordinatesSchema = z.tuple([z.number(), z.number(), z.number()]);

const captureZonesInput = z.strictObject({
  /** The mapId that `build_map` returned. */
  mapId: z.string().min(1),
  /** Zone names to capture; all zones of the map when omitted. */
  zones: z.array(z.string().min(1)).min(1).optional(),
  /** False in a follow-up call for `remainingZones`, which already has the cutaway from the first call. */
  cutaway: z.boolean().default(true),
  /** The views of each zone; `a` and `b` look from opposite sides over a cutaway, `eye` stands at player eye height with ceilings and walls shown. */
  views: z.array(zoneViewSchema).min(1).default(["a", "b"]),
  /** Which Studio holds the map; optional while exactly one is connected. */
  studioId: z.string().min(1).optional(),
});

/** What `set-cutaway-hidden.luau` reports: how many parts it hid or restored. */
const cutawayChangedSchema = z.strictObject({ changed: z.number() });

const captureZonesOutput = z.strictObject({
  mapId: z.string(),
  /** One entry per image block that follows the text block, in the same order. */
  shots: z.array(
    z.strictObject({
      /** The zone name; the top-down cutaway of the whole map carries the mapId. */
      zone: z.string(),
      /** `a` and `b` look at the zone from opposite sides; `eye` from player eye height inside it; `top` is the cutaway of the whole map from above. */
      view: z.enum(["a", "b", "top", "eye"]),
      cameraPosition: coordinatesSchema,
      lookAt: coordinatesSchema,
      /** Pixels of the image, read from the image itself. */
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  ),
  /** Zones left out by the per-call image cap; pass them as `zones` in a follow-up call. */
  remainingZones: z.array(z.string()),
  /** One entry per image whose long edge is outside the expected range. */
  warnings: z.array(z.string()),
});

/** What `read-map-zones.luau` reports: each zone with the studs bounds of its parts. */
const mapZonesSchema = z.strictObject({
  zones: z.array(z.strictObject({ name: z.string(), min: vectorSchema, max: vectorSchema })),
});

type ImageBlock = Extract<CallToolResult["content"][number], { type: "image" }>;

interface ImageSize {
  width: number;
  height: number;
}

/** The PNG signature, then the IHDR chunk: 4 length bytes, "IHDR", then width and height as 32-bit big-endian. */
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngWidthOffset = 16;
const pngHeaderBytes = 24;

function pngSize(bytes: Buffer): ImageSize | undefined {
  if (
    bytes.length < pngHeaderBytes ||
    !bytes.subarray(0, pngSignature.length).equals(pngSignature)
  ) {
    return undefined;
  }
  return {
    width: bytes.readUInt32BE(pngWidthOffset),
    height: bytes.readUInt32BE(pngWidthOffset + 4),
  };
}

/** JPEG markers start with 0xFF; SOI (0xD8) opens the file and each start-of-frame marker carries the size. */
const jpegSoiSecondByte = 0xd8;
/** The start-of-frame markers are 0xC0 to 0xCF except 0xC4 (huffman table), 0xC8 (reserved) and 0xCC (arithmetic conditioning). */
const jpegNonFrameMarkers = new Set([0xc4, 0xc8, 0xcc]);
const jpegMarkerHeaderBytes = 2;
/** Inside a start-of-frame segment after its 2 length bytes: 1 precision byte, then height and width as 16-bit big-endian. */
const jpegHeightOffsetInSegment = 3;

function isJpegFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && !jpegNonFrameMarkers.has(marker);
}

function jpegSize(bytes: Buffer): ImageSize | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== jpegSoiSecondByte) {
    return undefined;
  }
  let offset = jpegMarkerHeaderBytes;
  while (offset + jpegMarkerHeaderBytes + 2 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return undefined;
    }
    const marker = bytes[offset + 1] ?? 0;
    const segmentStart = offset + jpegMarkerHeaderBytes;
    if (isJpegFrameMarker(marker)) {
      const heightAt = segmentStart + jpegHeightOffsetInSegment;
      if (heightAt + 4 > bytes.length) {
        return undefined;
      }
      return { height: bytes.readUInt16BE(heightAt), width: bytes.readUInt16BE(heightAt + 2) };
    }
    offset = segmentStart + bytes.readUInt16BE(segmentStart);
  }
  return undefined;
}

/** Reads the pixel size from a PNG or JPEG image block's header; no image library needed for two integers. */
function imageSize(image: ImageBlock, shot: ViewedZoneShot): ImageSize {
  const bytes = Buffer.from(image.data, "base64");
  const size = pngSize(bytes) ?? jpegSize(bytes);
  if (size === undefined) {
    throw new Error(
      `screen_capture of zone "${shot.zone}" view ${shot.view} returned ${image.mimeType} data that is neither a readable PNG nor a readable JPEG, so its size is unknown.`,
    );
  }
  return size;
}

function longEdgeWarning(
  shot: ViewedZoneShot,
  size: { width: number; height: number },
): string | undefined {
  const longEdge = Math.max(size.width, size.height);
  if (longEdge >= config.imageLongEdgeMin && longEdge <= config.imageLongEdgeMax) {
    return undefined;
  }
  return `Image of zone "${shot.zone}" view ${shot.view} is ${String(size.width)}x${String(size.height)}: its long edge ${String(longEdge)} is outside ${String(config.imageLongEdgeMin)} to ${String(config.imageLongEdgeMax)} pixels. Resize the Studio viewport so the images stay legible without being downscaled by the model.`;
}

function selectZones(
  mapId: string,
  available: z.output<typeof mapZonesSchema>["zones"],
  requested: string[] | undefined,
): z.output<typeof mapZonesSchema>["zones"] {
  const names = available.map((zone) => zone.name);
  if (names.length === 0) {
    throw new Error(
      `Map "${mapId}" has no zones (no part named "<room>${config.floorNameSuffix}"). Build it with build_map first.`,
    );
  }
  if (requested === undefined) {
    return available;
  }
  const unknown = requested.filter((name) => !names.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `Map "${mapId}" has no zone named ${unknown.map((name) => `"${name}"`).join(", ")}. Zones: ${names.join(", ")}.`,
    );
  }
  return available.filter((zone) => requested.includes(zone.name));
}

type MapZone = z.output<typeof mapZonesSchema>["zones"][number];

/** The smallest bounds holding every zone. */
function unionBounds(zones: MapZone[]): Bounds {
  return {
    min: {
      x: Math.min(...zones.map((zone) => zone.min.x)),
      y: Math.min(...zones.map((zone) => zone.min.y)),
      z: Math.min(...zones.map((zone) => zone.min.z)),
    },
    max: {
      x: Math.max(...zones.map((zone) => zone.max.x)),
      y: Math.max(...zones.map((zone) => zone.max.y)),
      z: Math.max(...zones.map((zone) => zone.max.z)),
    },
  };
}

/**
 * The shots of one call: the top-down cutaway of the whole map first (unless `withCutaway` is false), then the
 * asked `views` of each selected zone (in the order a, b, eye) while the images fit `config.maxImagesPerCall`; the
 * zones that do not fit are returned by name and are never captured half.
 */
function planShots(
  mapId: string,
  allZones: MapZone[],
  selected: MapZone[],
  withCutaway: boolean,
  views: ZoneView[],
): { plannedShots: ViewedZoneShot[]; remainingZones: string[] } {
  const wholeMap = zoneShots({ name: mapId, bounds: unionBounds(allZones) });
  const cutaway = withCutaway ? wholeMap.filter((shot) => shot.view === "top") : [];
  const viewsPerZone = new Set(views).size;
  const zoneCapacity = Math.floor((config.maxImagesPerCall - cutaway.length) / viewsPerZone);
  const chosen = selected.slice(0, zoneCapacity);
  const remainingZones = selected.slice(zoneCapacity).map((zone) => zone.name);
  const zoneViewShots = chosen.flatMap((zone) =>
    zoneShots({ name: zone.name, bounds: { min: zone.min, max: zone.max } }).filter(
      (shot) => shot.view !== "top" && views.includes(shot.view),
    ),
  );
  return { plannedShots: [...cutaway, ...zoneViewShots], remainingZones };
}

/**
 * With `hidden`, hides the tagged ceilings of the map, so the shots see into the rooms, and the parts named by
 * `wallPrefixes`, restoring any other part hidden before; without it, restores every hidden part.
 */
async function setCutawayHidden(
  connection: StudioConnection,
  studioId: string,
  mapId: string,
  hidden: boolean,
  wallPrefixes: string[] = [],
): Promise<void> {
  await runLuauFile({
    connection,
    studioId,
    fileName: "set-cutaway-hidden.luau",
    datamodelType: "Edit",
    arguments: {
      mapId,
      mapsFolderName: config.mapsFolderName,
      ceilingTag: config.ceilingTag,
      originalTransparencyAttribute: config.cutawayOriginalTransparencyAttribute,
      hidden,
      wallPrefixes,
    },
    resultSchema: cutawayChangedSchema,
  });
}

/**
 * Name prefixes of the parts a shot hides besides the ceilings: the wall stretches and trim bands of its
 * zone's near wall (`nearWallSideOfView`), as build_map names them. The whole-map shot hides no wall.
 */
function nearWallPrefixes(mapId: string, shot: ViewedZoneShot): string[] {
  const side = nearWallSideOfView[shot.view];
  if (side === undefined || shot.zone === mapId) {
    return [];
  }
  const infixes = [config.wallNameInfix, ...wallBandNames.map((band) => `-${band}-`)];
  return infixes.map((infix) => `${shot.zone}${infix}${side}-`);
}

/** What a shot needs hidden: the ceilings (and the wall prefixes of `nearWallPrefixes`), or nothing for the eye view. */
interface CutawayState {
  hidden: boolean;
  wallPrefixes: string[];
}

/** The eye view is shot with ceilings and every wall shown, as a player sees the room; every other view needs the cutaway. */
function cutawayOfShot(mapId: string, shot: ViewedZoneShot): CutawayState {
  if (shot.view === "eye") {
    return { hidden: false, wallPrefixes: [] };
  }
  return { hidden: true, wallPrefixes: nearWallPrefixes(mapId, shot) };
}

function sameCutaway(first: CutawayState, second: CutawayState): boolean {
  return (
    first.hidden === second.hidden &&
    first.wallPrefixes.join("\n") === second.wallPrefixes.join("\n")
  );
}

/** Captures one shot through StudioMCP's `screen_capture` after `config.captureSettleMs`; the camera is set for that capture only. */
async function captureShot(
  connection: StudioConnection,
  studioId: string,
  mapId: string,
  shot: ViewedZoneShot,
): Promise<ImageBlock> {
  // Called through the module object so a test can mock the timer.
  await timers.setTimeout(config.captureSettleMs);
  const result = await connection.callTool({
    name: "screen_capture",
    studioId,
    arguments: {
      capture_id: `roblox-kit-${mapId}-${shot.zone}-${shot.view}`,
      camera_position: shot.cameraPosition,
      look_at_position: shot.lookAt,
    },
  });
  const image = result.content.find((block) => block.type === "image");
  if (result.isError === true || image === undefined) {
    const detail = result.content.map((block) => (block.type === "text" ? block.text : block.type));
    throw new Error(
      `screen_capture of zone "${shot.zone}" view ${shot.view} returned no image: ${detail.join(" ")}. Check that a Studio viewport is open on the place, then retry.`,
    );
  }
  return image;
}

export const captureZonesTool: ToolDefinition<typeof captureZonesInput, typeof captureZonesOutput> =
  {
    name: "capture_zones",
    title: "Capture zones",
    description:
      `Screenshots a map built by build_map: first one top-down cutaway of the whole map (view top, named by the mapId), then the asked views per zone (room), by default two from opposite sides (views a and b, at ${String(config.zoneShotPitchDegrees)} degrees pitch), framed for Studio's default ${String(config.studioFieldOfViewDegrees)}-degree field of view. ` +
      `Takes the mapId that build_map returned, the name of a Model under Workspace.${config.mapsFolderName}; the handle lasts while that Model exists in the open place, and a missing Model is an error. ` +
      `Optional zones lists the zone names to capture (default: all; each image costs context, so at most ${String(config.maxImagesPerCall)} images come back per call, the cutaway included; a zone is captured with all its asked views or not at all, and the zones beyond that are listed in remainingZones for a follow-up call, which passes cutaway false to skip the repeated cutaway). ` +
      `Optional views lists the views of each zone (default a and b); view eye stands at player eye height (${String(config.eyeHeightStuds)} studs) ${String(config.eyeInsetStuds)} studs in from the zone's -Z side, looks at the zone center pitched down ${String(config.eyePitchDegrees)} degrees, and is shot with ceilings and all walls shown. ` +
      `Ceilings (parts tagged ${config.ceilingTag}) are hidden during the captures of the other views, and so is a zone's south (+Z) wall with its trim during view a, which looks over it; all are restored afterwards, also when a capture fails, and a call that finds parts a crashed call left hidden restores them first. Each capture waits ${String(config.captureSettleMs)} ms first so the lighting settles, which makes a call take that long per image. Otherwise read-only: only the Studio camera moves, for each capture. Returns { mapId, shots: [{ zone, view, cameraPosition, lookAt, width, height }], remainingZones, warnings } with camera coordinates in studs and image sizes in pixels; warnings names each image whose long edge is outside ${String(config.imageLongEdgeMin)} to ${String(config.imageLongEdgeMax)} pixels. One image content block per shot follows, in the same order.`,
    inputSchema: captureZonesInput,
    outputSchema: captureZonesOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(input, context) {
      const studioId = await selectStudio(context.studio, input.studioId);
      // A call that died before its restore left parts hidden; this puts them back first.
      await setCutawayHidden(context.studio, studioId, input.mapId, false);
      const mapZones = await runLuauFile({
        connection: context.studio,
        studioId,
        fileName: "read-map-zones.luau",
        datamodelType: "Edit",
        arguments: {
          mapId: input.mapId,
          mapsFolderName: config.mapsFolderName,
          floorNameSuffix: config.floorNameSuffix,
          spawnNameSuffix: config.spawnNameSuffix,
          wallNameInfix: config.wallNameInfix,
        },
        resultSchema: mapZonesSchema,
      });
      const selected = selectZones(input.mapId, mapZones.zones, input.zones);
      const { plannedShots, remainingZones } = planShots(
        input.mapId,
        mapZones.zones,
        selected,
        input.cutaway,
        input.views,
      );
      // One at a time: every capture moves the same Studio camera.
      const captured: { shot: ViewedZoneShot; image: ImageBlock }[] = [];
      try {
        // The call start restored every part, so nothing is hidden yet.
        let applied: CutawayState = { hidden: false, wallPrefixes: [] };
        for (const shot of plannedShots) {
          const needed = cutawayOfShot(input.mapId, shot);
          if (!sameCutaway(needed, applied)) {
            await setCutawayHidden(
              context.studio,
              studioId,
              input.mapId,
              needed.hidden,
              needed.wallPrefixes,
            );
            applied = needed;
          }
          const image = await captureShot(context.studio, studioId, input.mapId, shot);
          captured.push({ shot, image });
        }
      } finally {
        await setCutawayHidden(context.studio, studioId, input.mapId, false);
      }
      const shots = captured.map(({ shot, image }) => ({
        ...shot,
        ...imageSize(image, shot),
      }));
      const warnings = shots.flatMap((shot) => longEdgeWarning(shot, shot) ?? []);
      return toolResult(
        { mapId: input.mapId, shots, remainingZones, warnings },
        captured.map(({ image }) => image),
      );
    },
  };
