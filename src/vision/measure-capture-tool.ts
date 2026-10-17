import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { config } from "../config.ts";
import { runLuauBatch, runLuauFile } from "../luau/run-luau-file.ts";
import { mapZonesBatchPart, mapZonesSchema } from "../map/read-map-zones.ts";
import { wallBandNames } from "../map/room-details.ts";
import { nearWallSideOfView, zoneShots, type ViewedZoneShot } from "../map/zone-cameras.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio } from "../studio/studio-connection.ts";
import { visionConfig } from "./vision-config.ts";

const visionFolder = ".roblox-kit/vision";
const maxDistanceStuds = 2000;
const maxSkippedParts = 32;

const inputSchema = z.strictObject({
  mapId: z.string().min(1).describe("The mapId that build_map returned."),
  zones: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe("Zone names to measure; all when omitted."),
  views: z
    .array(z.enum(["a", "b", "eye"]))
    .min(1)
    .default(["a", "b"])
    .describe("Views of each zone, framed as in capture_zones: a, b or eye."),
  grid: z
    .strictObject({ columns: z.int().min(2).max(26), rows: z.int().min(2).max(26) })
    .optional()
    .describe("Ray grid per view; defaults to 8 by 8."),
  studioId: z.string().min(1).optional().describe("Which Studio; optional while one is connected."),
});

const cellSchema = z.strictObject({
  distanceStuds: z.number(),
  material: z.string(),
  colorHex: z.string(),
  instanceKind: z.string(),
});
const cellOrMissSchema = z.union([cellSchema, z.literal(false).transform(() => null)]);

const probeSchema = z.strictObject({
  aspect: z.number(),
  shots: z.array(
    z.strictObject({
      zone: z.string(),
      view: z.string(),
      rows: z.array(z.array(cellOrMissSchema)),
    }),
  ),
});

const outputSchema = z.strictObject({
  mapId: z.string(),
  folder: z.string(),
  truthPath: z.string(),
  fieldOfViewDegrees: z.number(),
  aspect: z.number(),
  columns: z.int(),
  rows: z.int(),
  shots: z.array(
    z.strictObject({
      zone: z.string(),
      view: z.string(),
      cameraPosition: z.array(z.number()),
      lookAt: z.array(z.number()),
      hitCells: z.int(),
      missCells: z.int(),
    }),
  ),
});

function projectFolder(projectDir: string | undefined): string {
  return projectDir !== undefined && isAbsolute(projectDir) && !projectDir.includes("${")
    ? projectDir
    : process.cwd();
}

function ignoredPrefixes(mapId: string, shot: ViewedZoneShot): string[] {
  const side = nearWallSideOfView[shot.view];
  if (side === undefined || shot.zone === mapId) {
    return [];
  }
  const infixes = [config.wallNameInfix, ...wallBandNames.map((band) => `-${band}-`)];
  return infixes.map((infix) => `${shot.zone}${infix}${side}-`);
}

function selectZones(
  mapId: string,
  zones: z.output<typeof mapZonesSchema>["zones"],
  requested: string[] | undefined,
) {
  if (zones.length === 0) {
    throw new Error(
      `Map "${mapId}" has no zones (no part named "<room>${config.floorNameSuffix}"). Build it with build_map first.`,
    );
  }
  const unknown = (requested ?? []).filter((name) => !zones.some((zone) => zone.name === name));
  if (unknown.length > 0) {
    throw new Error(
      `Map "${mapId}" has no zone named ${unknown.map((name) => `"${name}"`).join(", ")}. Zones: ${zones.map((zone) => zone.name).join(", ")}.`,
    );
  }
  return requested === undefined ? zones : zones.filter((zone) => requested.includes(zone.name));
}

export function createMeasureCaptureTool(
  projectDir: string | undefined,
): ToolDefinition<typeof inputSchema, typeof outputSchema> {
  return {
    name: "measure_capture",
    title: "Measure capture",
    description:
      `Measures the ground truth behind capture_zones images: from each zone camera that capture_zones uses (views a, b or eye) it shoots a grid of rays (default 8 by 8) into a map built by build_map and records, per cell, the distance in studs, the material, the color hex and the instance kind of the first part hit, or null on a miss. ` +
      `Takes the mapId that build_map returned; optional zones (default all), views (default a and b) and grid. Parts that capture_zones hides (ceilings tagged ${config.ceilingTag}, a view a zone's south wall) are not hit, except in the eye view, which keeps ceilings. ` +
      `Read-only: no part changes and the Studio camera is restored. Writes truth.json under ${visionFolder}/<measureId> in the project folder, with the rows of cells per shot, the vertical field of view and the aspect ratio. ` +
      `Returns { mapId, folder, truthPath, fieldOfViewDegrees, aspect, columns, rows, shots: [{ zone, view, cameraPosition, lookAt, hitCells, missCells }] }.`,
    inputSchema,
    outputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(input, context) {
      const studioId = await selectStudio(context.studio, input.studioId);
      const grid = input.grid ?? {
        columns: visionConfig.depthGridColumns,
        rows: visionConfig.depthGridRows,
      };
      const [mapZones] = await runLuauBatch({
        connection: context.studio,
        studioId,
        datamodelType: "Edit",
        entries: [mapZonesBatchPart(input.mapId)],
      });
      const planned = selectZones(input.mapId, mapZones.zones, input.zones).flatMap((zone) =>
        zoneShots({ name: zone.name, bounds: { min: zone.min, max: zone.max } }).filter(
          (shot) => shot.view !== "top" && input.views.includes(shot.view),
        ),
      );
      const probe = await runLuauFile({
        connection: context.studio,
        studioId,
        datamodelType: "Edit",
        fileName: "raycast-grid.luau",
        arguments: {
          ...grid,
          fieldOfViewDegrees: config.studioFieldOfViewDegrees,
          maxDistanceStuds,
          maxSkippedParts,
          ceilingTag: config.ceilingTag,
          originalTransparencyAttribute: config.cutawayOriginalTransparencyAttribute,
          shots: planned.map((shot) => ({
            ...shot,
            hideCeilings: shot.view !== "eye",
            ignoredPrefixes: ignoredPrefixes(input.mapId, shot),
          })),
        },
        resultSchema: probeSchema,
      });
      if (probe.shots.length !== planned.length) {
        throw new Error(
          `raycast-grid.luau measured ${String(probe.shots.length)} of ${String(planned.length)} shots.`,
        );
      }
      const measureId = randomBytes(4).toString("hex");
      const folder = join(projectFolder(projectDir), visionFolder, measureId);
      await mkdir(folder, { recursive: true });
      const truthPath = join(folder, "truth.json");
      const truth = {
        mapId: input.mapId,
        fieldOfViewDegrees: config.studioFieldOfViewDegrees,
        aspect: probe.aspect,
        ...grid,
        shots: planned.map((shot, index) => ({
          zone: shot.zone,
          view: shot.view,
          cameraPosition: shot.cameraPosition,
          lookAt: shot.lookAt,
          rows: probe.shots[index]?.rows ?? [],
        })),
      };
      await writeFile(truthPath, JSON.stringify(truth, null, 2));
      const shots = truth.shots.map(({ rows, ...shot }) => {
        const cells = rows.flat();
        const hitCells = cells.filter((cell) => cell !== null).length;
        return { ...shot, hitCells, missCells: cells.length - hitCells };
      });
      return toolResult({
        mapId: truth.mapId,
        fieldOfViewDegrees: truth.fieldOfViewDegrees,
        aspect: truth.aspect,
        ...grid,
        folder,
        truthPath,
        shots,
      });
    },
  };
}
