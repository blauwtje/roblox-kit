import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { config } from "../config.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio, type StudioConnection } from "../studio/studio-connection.ts";
import { zoneShot, type ZoneShot } from "./zone-cameras.ts";

const vectorSchema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const coordinatesSchema = z.tuple([z.number(), z.number(), z.number()]);

const captureZonesInput = z.strictObject({
  /** The mapId that `build_map` returned. */
  mapId: z.string().min(1),
  /** Zone names to capture; all zones of the map when omitted. */
  zones: z.array(z.string().min(1)).min(1).optional(),
  /** Which Studio holds the map; optional while exactly one is connected. */
  studioId: z.string().min(1).optional(),
});

/** What `set-ceilings-hidden.luau` reports: how many ceilings it hid or restored. */
const ceilingsChangedSchema = z.strictObject({ changed: z.number() });

const captureZonesOutput = z.strictObject({
  mapId: z.string(),
  /** One entry per image block that follows the text block, in the same order. */
  shots: z.array(
    z.strictObject({
      zone: z.string(),
      cameraPosition: coordinatesSchema,
      lookAt: coordinatesSchema,
    }),
  ),
});

/** What `read-map-zones.luau` reports: each zone with the studs bounds of its parts. */
const mapZonesSchema = z.strictObject({
  zones: z.array(z.strictObject({ name: z.string(), min: vectorSchema, max: vectorSchema })),
});

type ImageBlock = Extract<CallToolResult["content"][number], { type: "image" }>;

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

/** Hides or restores the tagged ceilings of the map, so a top-down shot sees into the rooms. */
async function setCeilingsHidden(
  connection: StudioConnection,
  studioId: string,
  mapId: string,
  hidden: boolean,
): Promise<void> {
  await runLuauFile({
    connection,
    studioId,
    fileName: "set-ceilings-hidden.luau",
    datamodelType: "Edit",
    arguments: {
      mapId,
      mapsFolderName: config.mapsFolderName,
      ceilingTag: config.ceilingTag,
      originalTransparencyAttribute: config.ceilingOriginalTransparencyAttribute,
      hidden,
    },
    resultSchema: ceilingsChangedSchema,
  });
}

/** Captures one shot through StudioMCP's `screen_capture`; the camera is set for that capture only. */
async function captureShot(
  connection: StudioConnection,
  studioId: string,
  mapId: string,
  shot: ZoneShot,
): Promise<ImageBlock> {
  const result = await connection.callTool({
    name: "screen_capture",
    studioId,
    arguments: {
      capture_id: `roblox-kit-${mapId}-${shot.zone}`,
      camera_position: shot.cameraPosition,
      look_at_position: shot.lookAt,
    },
  });
  const image = result.content.find((block) => block.type === "image");
  if (result.isError === true || image === undefined) {
    const detail = result.content.map((block) => (block.type === "text" ? block.text : block.type));
    throw new Error(
      `screen_capture of zone "${shot.zone}" returned no image: ${detail.join(" ")}. Check that a Studio viewport is open on the place, then retry.`,
    );
  }
  return image;
}

export const captureZonesTool: ToolDefinition<typeof captureZonesInput, typeof captureZonesOutput> =
  {
    name: "capture_zones",
    title: "Capture zones",
    description:
      `Screenshots each zone (room) of a map built by build_map, one angled shot per zone at ${String(config.zoneShotPitchDegrees)} degrees pitch, framed for Studio's default ${String(config.studioFieldOfViewDegrees)}-degree field of view. ` +
      `Takes the mapId that build_map returned, the name of a Model under Workspace.${config.mapsFolderName}; the handle lasts while that Model exists in the open place, and a missing Model is an error. ` +
      `Optional zones lists the zone names to capture (default: all; each image costs context, so pass a few for large maps). ` +
      `Ceilings (parts tagged ${config.ceilingTag}) are hidden during the captures and restored afterwards, also when a capture fails; a call that finds ceilings a crashed call left hidden restores them first. Otherwise read-only: only the Studio camera moves, for each capture. Returns { mapId, shots: [{ zone, cameraPosition, lookAt }] } in studs, followed by one image content block per shot in the same order.`,
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
      // A call that died before its restore left ceilings hidden; this puts them back first.
      await setCeilingsHidden(context.studio, studioId, input.mapId, false);
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
      const chosen = selectZones(input.mapId, mapZones.zones, input.zones);
      const shots = chosen.map((zone) =>
        zoneShot({ name: zone.name, bounds: { min: zone.min, max: zone.max } }),
      );
      // One at a time: every capture moves the same Studio camera.
      const images: ImageBlock[] = [];
      try {
        await setCeilingsHidden(context.studio, studioId, input.mapId, true);
        for (const shot of shots) {
          images.push(await captureShot(context.studio, studioId, input.mapId, shot));
        }
      } finally {
        await setCeilingsHidden(context.studio, studioId, input.mapId, false);
      }
      return toolResult({ mapId: input.mapId, shots }, images);
    },
  };
