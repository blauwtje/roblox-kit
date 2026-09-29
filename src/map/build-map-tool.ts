import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.ts";
import { applyLighting } from "../lighting/apply-lighting.ts";
import { placeLights } from "../lighting/light-placement.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio } from "../studio/studio-connection.ts";
import { loadPresets } from "../style/load-preset.ts";
import type { Preset } from "../style/preset-schema.ts";
import { resolveStyle } from "../style/resolve-style.ts";
import { layoutMap, type PartRecord, type Vector } from "./map-layout.ts";
import { relationMapSpecSchema, type MapSpec, type TerrainFill } from "./map-spec.ts";
import { placeProps, type PropRecord } from "./prop-placement.ts";
import { buildRoomDetails, type DetailPart } from "./room-details.ts";
import { resolveRelations } from "./relation-solver.ts";

const presets = await loadPresets();

const propGeneratorDirectory = new URL("../../luau/props/", import.meta.url);

const vectorSchema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const boundsSchema = z.strictObject({ min: vectorSchema, max: vectorSchema });

const buildMapInput = relationMapSpecSchema.safeExtend({
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

type Variant = NonNullable<Preset["surfaces"][keyof Preset["surfaces"]]["variant"]>;
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

/** A part of a room: a layout part or a decorative detail. */
type RoomPart = Pick<PartRecord, "room" | "position" | "size">;

function zonesOf(parts: RoomPart[]): z.infer<typeof buildMapOutput>["zones"] {
  const partsByRoom = Map.groupBy(parts, (part) => part.room);
  return [...partsByRoom].map(([name, roomParts]) => ({
    name,
    partCount: roomParts.length,
    bounds: unionOf(roomParts.map((part) => boundsOfBox(part.position, part.size))),
  }));
}

/** The flat MaterialVariant of each surface role of the style that names one; none without a style. */
function variantsOf(style: Preset | undefined): Record<string, Variant> {
  const variants: Record<string, Variant> = {};
  for (const [role, surface] of Object.entries(style?.surfaces ?? {})) {
    if (surface.variant !== undefined) {
      variants[role] = surface.variant;
    }
  }
  return variants;
}

/** The generator source of each prop kind in use, read from `luau/props/<kind>.luau`. */
async function generatorsOf(props: PropRecord[]): Promise<Record<string, string>> {
  const generators: Record<string, string> = {};
  for (const kind of new Set(props.map((prop) => prop.kind))) {
    generators[kind] = await readFile(new URL(`${kind}.luau`, propGeneratorDirectory), "utf8");
  }
  return generators;
}

/** One light for `build-map.luau`: hung at `position`, parented under the floor part of its zone. */
interface LightRecord {
  zone: string;
  /** Name of the floor part of the zone that holds the light's Attachment. */
  part: string;
  role: string;
  position: Vector;
  range: number;
  shadows: boolean;
  brightness: number;
  color: string;
}

/**
 * The lights the style's light roles place, each tied to the floor part of the room centered where
 * the light hangs. Placements carry no room name; the first room with that center takes it.
 */
function lightRecordsOf(
  spec: MapSpec,
  parts: PartRecord[],
  style: Preset | undefined,
): LightRecord[] {
  if (style === undefined) {
    return [];
  }
  return placeLights(spec, style.lightRoles).map((placement) => {
    const room = spec.rooms.find(
      (candidate) => candidate.x === placement.position.x && candidate.z === placement.position.z,
    );
    const floor = parts.find((part) => part.kind === "floor" && part.room === room?.name);
    if (room === undefined || floor === undefined) {
      throw new Error(
        `No room floor found for the ${placement.role} light at ${JSON.stringify(placement.position)}.`,
      );
    }
    const { brightness, color } = style.lightRoles[placement.role];
    return { ...placement, zone: room.name, part: floor.name, brightness, color };
  });
}

export const buildMapTool: ToolDefinition<typeof buildMapInput, typeof buildMapOutput> = {
  name: "build_map",
  title: "Build map",
  description:
    `Builds a map from a data spec in the open place: per room an anchored floor, walls with door gaps and an optional SpawnLocation, plus terrain fills. With a style each room also gets a ceiling (tagged ${config.ceilingTag}, not colliding), baseboard, crown, stripe, pillar and arch details in the preset's trim and accent colors (none collide) and props from the preset's kit, each a ProceduralModel that shares one generator ModuleScript per kind in the map Model and is generated before the build returns; without a style none of these are built. A room gives its center (x, z) or a relation { to, direction, hallwayLength, hallwayWidth } that sets it beside another room on the 5-stud grid, joined by a hallway room named "<to>-<room>-hallway" that is one more zone. An optional style { preset, overrides } names a genre preset, is checked before Studio is asked, paints parts in its palette colors and materials, hangs point lights from its light roles under each room's floor, applies its lighting recipe to Lighting (the previous values are stored on the map Model for restore) and gives a role that names a MaterialVariant one flat MaterialVariant in MaterialService, named after the map and role and reused on rebuild; an optional seed defaults to ${String(config.defaultSeed)}. ` +
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
    // Resolving relations and the style and laying out first keep a spec that cannot be built from touching Studio.
    const spec = resolveRelations(input);
    const style = spec.style === undefined ? undefined : resolveStyle(presets, spec.style);
    // A style is the switch for the decor: ceilings, trim details and props come with a preset, never without.
    const layout = layoutMap(spec, style?.surfaces, { ceilings: style !== undefined });
    const details: DetailPart[] =
      style === undefined ? [] : buildRoomDetails(spec, layout.parts, style.surfaces);
    const props: PropRecord[] =
      style === undefined ? [] : placeProps(spec, style.propKit, spec.seed ?? config.defaultSeed);
    const generators = await generatorsOf(props);
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
        details,
        props,
        generators,
        ceilingTag: config.ceilingTag,
        terrainFills: layout.terrainFills,
        variants: variantsOf(style),
        lights: lightRecordsOf(spec, layout.parts, style),
      },
      resultSchema: builtMapSchema,
    });
    if (style !== undefined) {
      await applyLighting({
        connection: context.studio,
        studioId,
        mapsFolderName: config.mapsFolderName,
        mapId: input.mapId,
        recipe: style.lighting,
      });
    }
    const bounds = unionOf([
      ...[...layout.parts, ...details].map((part) => boundsOfBox(part.position, part.size)),
      ...layout.terrainFills.map(boundsOfFill),
    ]);
    return toolResult({
      mapId: input.mapId,
      partCount: built.partCount,
      bounds,
      zones: zonesOf([...layout.parts, ...details]),
    });
  },
};
