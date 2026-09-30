import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.ts";
import { applyLighting } from "../lighting/apply-lighting.ts";
import { placeLights } from "../lighting/light-placement.ts";
import type { FixtureBox } from "../lighting/light-placement.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio } from "../studio/studio-connection.ts";
import { loadPresets } from "../style/load-preset.ts";
import type { Preset } from "../style/preset-schema.ts";
import { resolveStyle } from "../style/resolve-style.ts";
import { groupBuildPhases, type BuildPhase, type BuildPhaseName } from "./build-phases.ts";
import { layoutMap, type PartRecord, type Vector } from "./map-layout.ts";
import { relationMapSpecSchema, type MapSpec, type TerrainFill } from "./map-spec.ts";
import { placeArrangements } from "./arrangement-placement.ts";
import { placeProps, type PropRecord } from "./prop-placement.ts";
import { placeSetPieces } from "./set-piece-placement.ts";
import { doorwayClearanceBoxes } from "./size-rules.ts";
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
  /** The six build phases in the order they ran, each with the number of parts it built. */
  phases: z.array(z.strictObject({ name: z.string(), partCount: z.number().int() })),
  bounds: boundsSchema,
  zones: z.array(
    z.strictObject({ name: z.string(), partCount: z.number().int(), bounds: boundsSchema }),
  ),
  /** One line per set piece skipped because its room has no space for it. */
  warnings: z.array(z.string()),
});

/** What `build-map.luau` reports after a phase: the parts in the Model; the shell phase also says whether it replaced a map. */
const builtPhaseSchema = z.strictObject({
  partCount: z.number().int(),
  replaced: z.boolean().optional(),
});

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
  /** The visible fixture box that holds the light, and whether it hangs from the ceiling; absent for the center and focal lights. */
  fixture?: FixtureBox & { pendant: boolean };
  brightness: number;
  color: string;
}

/** The lights the style's light roles and fixtures place, each tied to the floor part of its zone's room. */
function lightRecordsOf(
  spec: MapSpec,
  parts: PartRecord[],
  style: Preset | undefined,
): LightRecord[] {
  if (style === undefined) {
    return [];
  }
  return placeLights(spec, style.lightRoles, style.lightFixtures).map((placement) => {
    const floor = parts.find((part) => part.kind === "floor" && part.room === placement.zone);
    if (floor === undefined) {
      throw new Error(
        `No room floor found for the ${placement.role} light at ${JSON.stringify(placement.position)} of zone ${placement.zone}.`,
      );
    }
    const { brightness, color } = style.lightRoles[placement.role];
    const fixture = placement.fixture && {
      ...placement.fixture,
      pendant: style.lightFixtures?.kind === "pendant",
    };
    return { ...placement, fixture, part: floor.name, brightness, color };
  });
}

/** What every phase of one build shares. */
interface BuildContext {
  mapId: string;
  terrainFills: TerrainFill[];
  variants: Record<string, Variant>;
  generators: Record<string, string>;
  /** Every material name of the build, checked by the shell phase before anything is built. */
  materials: string[];
}

/** The arguments `build-map.luau` takes for one phase, beside the phase name, the map id and the maps folder. */
function phaseArguments(
  phase: BuildPhase<LightRecord>,
  build: BuildContext,
): Record<string, unknown> {
  const base = { phase: phase.name, mapId: build.mapId, mapsFolderName: config.mapsFolderName };
  const argumentsByPhase: Record<BuildPhaseName, Record<string, unknown>> = {
    shell: {
      parts: phase.parts,
      terrainFills: build.terrainFills,
      variants: build.variants,
      materials: build.materials,
    },
    "floors and ceilings": {
      parts: phase.parts,
      variants: build.variants,
      ceilingTag: config.ceilingTag,
    },
    openings: { parts: phase.parts, variants: build.variants },
    surfaces: { parts: phase.parts, variants: build.variants },
    props: { props: phase.parts, generators: build.generators },
    lighting: {
      lights: phase.parts,
      ceilingTag: config.ceilingTag,
      ceilingDropStuds: config.lightCeilingDropStuds,
      fixtureSizeStuds: config.lightFixtureSizeStuds,
    },
  };
  return { ...base, ...argumentsByPhase[phase.name] };
}

/** The material names of the parts, details, terrain fills and variants of a build. */
function materialsOf(
  parts: { material: string }[],
  terrainFills: TerrainFill[],
  variants: Record<string, Variant>,
): string[] {
  return [
    ...parts.map((part) => part.material),
    ...terrainFills.map((fill) => fill.material),
    ...Object.values(variants).map((variant) => variant.baseMaterial),
  ];
}

/** Throws naming the first room whose type the style lacks; a room type needs a style that declares it. */
function rejectUnknownRoomTypes(spec: MapSpec, style: Preset | undefined): void {
  const known = Object.keys(style?.roomTypes ?? {});
  for (const room of spec.rooms) {
    if (room.roomType === undefined || known.includes(room.roomType)) {
      continue;
    }
    const declared = known.length === 0 ? "none" : known.join(", ");
    throw new Error(
      `Room "${room.name}" has room type "${room.roomType}", which the style does not declare; declared room types: ${declared}`,
    );
  }
}

/** A prop with the generator attributes its preset surface role adds. */
type StyledPropRecord = PropRecord & { attributes?: Record<string, string> };

/** The prop with `SurfaceColor` and `SurfaceMaterial` from its kind's surface role; unchanged without a role. */
function withSurface(prop: StyledPropRecord, style: Preset): StyledPropRecord {
  const role = style.propRules[prop.kind]?.surface;
  if (role === undefined) {
    return prop;
  }
  const { color, material } = style.surfaces[role];
  return {
    ...prop,
    attributes: { ...prop.attributes, SurfaceColor: color, SurfaceMaterial: material },
  };
}

/**
 * The props of a styled map: kit props in plain rooms, and in typed rooms the set pieces of their room type
 * followed by its arrangements, which would collide with random kit props; warnings name each set piece
 * skipped for lack of space and each arrangement that placed nothing; a prop whose rule names a surface role
 * carries that role's color and material as attributes.
 */
export function propsOf(
  spec: MapSpec,
  style: Preset,
): { props: StyledPropRecord[]; warnings: string[] } {
  const seed = spec.seed ?? config.defaultSeed;
  const plainSpec = { ...spec, rooms: spec.rooms.filter((room) => room.roomType === undefined) };
  const agent = { radius: style.sizeRules.agentRadius, height: style.sizeRules.agentHeight };
  const setPieces = placeSetPieces(
    spec,
    style.roomTypes,
    style.palette.accent,
    seed,
    doorwayClearanceBoxes(spec, agent),
  );
  const arrangements = placeArrangements(spec, style.roomTypes, setPieces.pieces, seed);
  return {
    props: [
      ...placeProps(plainSpec, style.propKit, seed),
      ...setPieces.pieces,
      ...arrangements.pieces,
    ].map((prop) => withSurface(prop, style)),
    warnings: [...setPieces.warnings, ...arrangements.warnings],
  };
}

export const buildMapTool: ToolDefinition<typeof buildMapInput, typeof buildMapOutput> = {
  name: "build_map",
  title: "Build map",
  description:
    `Builds a map from a data spec in the open place: per room an anchored floor, walls with door gaps and an optional SpawnLocation, plus terrain fills. With a style each room also gets a ceiling (tagged ${config.ceilingTag}, not colliding), baseboard, crown, stripe, pillar and arch details in the preset's trim and accent colors (none collide) and props from the preset's kit, each a ProceduralModel that shares one generator ModuleScript per kind in the map Model and is generated before the build returns; without a style none of these are built. A room gives its center (x, z) or a relation { to, direction, hallwayLength, hallwayWidth } that sets it beside another room on the 5-stud grid, joined by a hallway room named "<to>-<room>-hallway" that is one more zone. An optional style { preset, overrides } names a genre preset, is checked before Studio is asked, paints parts in its palette colors and materials, hangs point lights from its light roles under each room's floor (each light within ${String(config.lightCeilingDropStuds)} stud of a ceiling also gets a ${String(config.lightFixtureSizeStuds)}-stud Neon fixture part against the ceiling, tagged ${config.ceilingTag} so it hides with the ceilings), applies its lighting recipe to Lighting (the previous values are stored on the map Model for restore) and gives a role that names a MaterialVariant one flat MaterialVariant in MaterialService, named after the map and role and reused on rebuild; an optional seed defaults to ${String(config.defaultSeed)}. ` +
    `The map is one Model named mapId under Workspace.${config.mapsFolderName}, and mapId is the handle that later tools take. ` +
    `The handle lasts while that Model exists in the open place, including across calls and saves. Calling build_map again with the same mapId ` +
    `replaces the Model and clears the terrain its previous build filled. Studio may not offer an undo step (undo recording is unavailable to execute_luau). ` +
    `The build runs in six phases (shell, floors and ceilings, openings, surfaces, props, lighting), reporting progress after each; a phase that fails stops the build and may leave a partial Model, which building again with the same mapId replaces. ` +
    `Returns { mapId, partCount, phases, bounds, zones, warnings }: the parts per phase, the studs bounds of the whole map and of each room (zone), and one warning per set piece skipped because its room has no space for it.`,
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
    rejectUnknownRoomTypes(spec, style);
    // A style is the switch for the decor: ceilings, trim details and props come with a preset, never without.
    const layout = layoutMap(spec, style?.surfaces, { ceilings: style !== undefined });
    const details: DetailPart[] =
      style === undefined ? [] : buildRoomDetails(spec, layout.parts, style.surfaces);
    const { props, warnings } =
      style === undefined ? { props: [], warnings: [] } : propsOf(spec, style);
    const generators = await generatorsOf(props);
    const variants = variantsOf(style);
    const lights = lightRecordsOf(spec, layout.parts, style);
    const build: BuildContext = {
      mapId: input.mapId,
      terrainFills: layout.terrainFills,
      variants,
      generators,
      materials: materialsOf([...layout.parts, ...details], layout.terrainFills, variants),
    };
    const studioId = await selectStudio(context.studio, input.studioId);
    const phases = groupBuildPhases({ parts: layout.parts, details, props, lights });
    let partCount = 0;
    for (const [index, phase] of phases.entries()) {
      try {
        const built = await runLuauFile({
          connection: context.studio,
          studioId,
          fileName: "build-map.luau",
          datamodelType: "Edit",
          arguments: phaseArguments(phase, build),
          resultSchema: builtPhaseSchema,
        });
        partCount = built.partCount;
        if (phase.name === "lighting") {
          // Without a style the recipe is absent: the previous build's Lighting is restored.
          await applyLighting({
            connection: context.studio,
            studioId,
            mapsFolderName: config.mapsFolderName,
            mapId: input.mapId,
            recipe: style?.lighting,
          });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Building map "${input.mapId}" failed in the "${phase.name}" phase; the Model may be partial: ${reason}`,
          { cause: error },
        );
      }
      await context.reportProgress?.(index + 1, phases.length, phase.name);
    }
    const bounds = unionOf([
      ...[...layout.parts, ...details].map((part) => boundsOfBox(part.position, part.size)),
      ...layout.terrainFills.map(boundsOfFill),
    ]);
    return toolResult({
      mapId: input.mapId,
      partCount,
      phases: phases.map((phase) => ({ name: phase.name, partCount: phase.parts.length })),
      bounds,
      zones: zonesOf([...layout.parts, ...details]),
      warnings,
    });
  },
};
