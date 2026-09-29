import { z } from "zod";
import { config } from "../config.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio } from "../studio/studio-connection.ts";
import { layoutMap, type PartRecord, type Vector } from "./map-layout.ts";
import { mapSpecSchema, type TerrainFill } from "./map-spec.ts";

const vectorSchema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const boundsSchema = z.strictObject({ min: vectorSchema, max: vectorSchema });

const buildMapInput = mapSpecSchema.safeExtend({
  /** Which Studio builds the map; optional while exactly one is connected. */
  studioId: z.string().min(1).optional(),
});

const buildMapOutput = z.strictObject({
  mapId: z.string(),
  partCount: z.number().int(),
  bounds: boundsSchema,
  zones: z.array(
    z.strictObject({ name: z.string(), partCount: z.number().int(), bounds: boundsSchema }),
  ),
});

/** What `build-map.luau` reports about the Model it built. */
const builtMapSchema = z.strictObject({ partCount: z.number().int(), replaced: z.boolean() });

type Bounds = z.infer<typeof boundsSchema>;

function boundsOfBox(center: Vector, size: Vector): Bounds {
  return {
    min: { x: center.x - size.x / 2, y: center.y - size.y / 2, z: center.z - size.z / 2 },
    max: { x: center.x + size.x / 2, y: center.y + size.y / 2, z: center.z + size.z / 2 },
  };
}

function boundsOfFill(fill: TerrainFill): Bounds {
  if (fill.shape === "block") {
    return boundsOfBox(fill.center, fill.size);
  }
  const diameter = 2 * fill.radius;
  return boundsOfBox(fill.center, { x: diameter, y: diameter, z: diameter });
}

function unionOf(boundsList: Bounds[]): Bounds {
  const [first, ...rest] = boundsList;
  if (first === undefined) {
    throw new Error("A map needs at least one room or terrain fill to have bounds.");
  }
  return rest.reduce<Bounds>(
    (union, next) => ({
      min: {
        x: Math.min(union.min.x, next.min.x),
        y: Math.min(union.min.y, next.min.y),
        z: Math.min(union.min.z, next.min.z),
      },
      max: {
        x: Math.max(union.max.x, next.max.x),
        y: Math.max(union.max.y, next.max.y),
        z: Math.max(union.max.z, next.max.z),
      },
    }),
    first,
  );
}

function zonesOf(parts: PartRecord[]): z.infer<typeof buildMapOutput>["zones"] {
  const partsByRoom = Map.groupBy(parts, (part) => part.room);
  return [...partsByRoom].map(([name, roomParts]) => ({
    name,
    partCount: roomParts.length,
    bounds: unionOf(roomParts.map((part) => boundsOfBox(part.position, part.size))),
  }));
}

export const buildMapTool: ToolDefinition<typeof buildMapInput, typeof buildMapOutput> = {
  name: "build_map",
  title: "Build map",
  description:
    `Builds a map from a data spec in the open place: per room an anchored floor, walls with door gaps and an optional SpawnLocation, plus terrain fills. ` +
    `The map is one Model named mapId under Workspace.${config.mapsFolderName}, and mapId is the handle that later tools take. ` +
    `The handle lasts while that Model exists in the open place, including across calls and saves. Calling build_map again with the same mapId ` +
    `replaces the Model and clears the terrain its previous build filled. Studio may not offer an undo step (undo recording is unavailable to execute_luau). ` +
    `Returns { mapId, partCount, bounds, zones }: the studs bounds of the whole map and of each room (zone).`,
  inputSchema: buildMapInput,
  outputSchema: buildMapOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    // Laying out first keeps a spec that cannot be built from touching Studio.
    const layout = layoutMap(input);
    const studioId = await selectStudio(context.studio, input.studioId);
    const built = await runLuauFile({
      connection: context.studio,
      studioId,
      fileName: "build-map.luau",
      datamodelType: "Edit",
      arguments: {
        mapId: input.mapId,
        mapsFolderName: config.mapsFolderName,
        parts: layout.parts,
        terrainFills: layout.terrainFills,
      },
      resultSchema: builtMapSchema,
    });
    const bounds = unionOf([
      ...layout.parts.map((part) => boundsOfBox(part.position, part.size)),
      ...layout.terrainFills.map(boundsOfFill),
    ]);
    return toolResult({
      mapId: input.mapId,
      partCount: built.partCount,
      bounds,
      zones: zonesOf(layout.parts),
    });
  },
};
