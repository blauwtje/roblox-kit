import timers from "node:timers/promises";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { config } from "../config.ts";
import { runLuauBatch, runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio, type StudioConnection } from "../studio/studio-connection.ts";
import { mapZonesBatchPart, mapZonesSchema } from "./read-map-zones.ts";
import { wallBandNames } from "./room-details.ts";
import { nearWallSideOfView, zoneShots, type Bounds, type ViewedZoneShot } from "./zone-cameras.ts";

const zoneViewSchema = z.enum(["a", "b", "eye"]);
type ZoneView = z.output<typeof zoneViewSchema>;

const coordinatesSchema = z.tuple([z.number(), z.number(), z.number()]);

const captureZonesInput = z.strictObject({
  mapId: z.string().min(1).describe("The mapId that build_map returned."),
  zones: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe("Zone names to capture; all when omitted."),
  cutaway: z.boolean().default(true).describe("False in a follow-up call for remainingZones."),
  views: z
    .array(zoneViewSchema)
    .min(1)
    .default(["a", "b"])
    .describe("Views of each zone: a, b or eye."),
  studioId: z.string().min(1).optional().describe("Which Studio; optional while one is connected."),
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
function cutawayBatchPart(mapId: string, hidden: boolean, wallPrefixes: string[] = []) {
  return {
    fileName: "set-cutaway-hidden.luau",
    arguments: {
      mapId,
      mapsFolderName: config.mapsFolderName,
      ceilingTag: config.ceilingTag,
      originalTransparencyAttribute: config.cutawayOriginalTransparencyAttribute,
      hidden,
      wallPrefixes,
    },
    resultSchema: cutawayChangedSchema,
  };
}

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
    datamodelType: "Edit",
    ...cutawayBatchPart(mapId, hidden, wallPrefixes),
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

function applyCutaway(
  target: { connection: StudioConnection; studioId: string; mapId: string },
  state: CutawayState,
): Promise<void> {
  return setCutawayHidden(
    target.connection,
    target.studioId,
    target.mapId,
    state.hidden,
    state.wallPrefixes,
  );
}

function sameCutaway(first: CutawayState, second: CutawayState): boolean {
  return (
    first.hidden === second.hidden &&
    first.wallPrefixes.join("\n") === second.wallPrefixes.join("\n")
  );
}

async function captureShot(
  connection: StudioConnection,
  studioId: string,
  mapId: string,
  shot: ViewedZoneShot,
  settleMs: number,
): Promise<ImageBlock> {
  // Called through the module object so a test can mock the timer.
  await timers.setTimeout(settleMs);
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

type CapturedShot = { shot: ViewedZoneShot; image: ImageBlock };

async function captureEachShot(
  target: { connection: StudioConnection; studioId: string; mapId: string },
  plannedShots: ViewedZoneShot[],
): Promise<CapturedShot[]> {
  const captured: CapturedShot[] = [];
  let applied: CutawayState = { hidden: false, wallPrefixes: [] };
  let settleMs: number = config.captureSettleMs;
  for (const shot of plannedShots) {
    const needed = cutawayOfShot(target.mapId, shot);
    if (!sameCutaway(needed, applied)) {
      await applyCutaway(target, needed);
      applied = needed;
      settleMs = config.captureSettleMs;
    }
    const image = await captureShot(
      target.connection,
      target.studioId,
      target.mapId,
      shot,
      settleMs,
    );
    settleMs = config.captureCameraSettleMs;
    captured.push({ shot, image });
  }
  return captured;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function captureInOrder(
  target: { connection: StudioConnection; studioId: string; mapId: string },
  plannedShots: ViewedZoneShot[],
): Promise<CapturedShot[]> {
  let captured: CapturedShot[];
  try {
    captured = await captureEachShot(target, plannedShots);
  } catch (error) {
    try {
      await setCutawayHidden(target.connection, target.studioId, target.mapId, false);
    } catch (restoreError) {
      const note = ` Restoring the cutaway also failed: ${errorText(restoreError)}`;
      throw error instanceof Error
        ? Object.assign(error, { message: error.message + note })
        : new Error(errorText(error) + note);
    }
    throw error;
  }
  try {
    await setCutawayHidden(target.connection, target.studioId, target.mapId, false);
  } catch (restoreError) {
    throw new Error(
      `The captures succeeded but restoring the cutaway failed: ${errorText(restoreError)} The ceilings (parts tagged ${config.ceilingTag}) and the near walls of map "${target.mapId}" may still be hidden; the next capture_zones call on this map restores them.`,
      { cause: restoreError },
    );
  }
  return captured;
}

export const captureZonesTool: ToolDefinition<typeof captureZonesInput, typeof captureZonesOutput> =
  {
    name: "capture_zones",
    title: "Capture zones",
    description:
      `Screenshots a map built by build_map: first one top-down cutaway of the whole map (view top), then the asked views per zone (room), framed for Studio's default ${String(config.studioFieldOfViewDegrees)}-degree field of view. ` +
      `Takes the mapId that build_map returned, a Model under Workspace.${config.mapsFolderName}; the handle lasts while that Model exists in the open place, and a missing Model is an error. ` +
      `Optional inputs: zones lists the zone names (default all; at most ${String(config.maxImagesPerCall)} images come back per call, the cutaway included, a zone whole or not at all, and the rest are listed in remainingZones); views lists the views per zone (default a and b from opposite sides at ${String(config.zoneShotPitchDegrees)} degrees pitch; eye stands at eye height, ${String(config.eyeHeightStuds)} studs, with ceilings and walls shown); cutaway false skips the cutaway in a follow-up call; studioId picks the Studio. An input the user did not ask for stays at its default. ` +
      `Ceilings (tag ${config.ceilingTag}) and a zone's south wall in view a are hidden during captures and restored afterwards, also on failure. Otherwise read-only: only the Studio camera moves. ` +
      `Returns { mapId, shots: [{ zone, view, cameraPosition, lookAt, width, height }], remainingZones, warnings }, with warnings naming each image whose long edge is outside ${String(config.imageLongEdgeMin)} to ${String(config.imageLongEdgeMax)} pixels. One image content block per shot follows, in order.`,
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
      const [, mapZones] = await runLuauBatch({
        connection: context.studio,
        studioId,
        datamodelType: "Edit",
        entries: [cutawayBatchPart(input.mapId, false), mapZonesBatchPart(input.mapId)],
      });
      const selected = selectZones(input.mapId, mapZones.zones, input.zones);
      const { plannedShots, remainingZones } = planShots(
        input.mapId,
        mapZones.zones,
        selected,
        input.cutaway,
        input.views,
      );
      const captured = await captureInOrder(
        { connection: context.studio, studioId, mapId: input.mapId },
        plannedShots,
      );
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
