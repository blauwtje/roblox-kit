import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.ts";
import { applyLighting } from "../lighting/apply-lighting.ts";
import { placeLights } from "../lighting/light-placement.ts";
import type { FixtureBox } from "../lighting/light-placement.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolContext, ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio } from "../studio/studio-connection.ts";
import { loadPresets } from "../style/load-preset.ts";
import { materialMapSize, type IdleAnimation, type Preset } from "../style/preset-schema.ts";
import { resolveStyle } from "../style/resolve-style.ts";
import { lintPalette, paletteIssueKinds } from "../style/palette-lint.ts";
import { findLookIssues, lookIssueKinds } from "./look-lint.ts";
import { groupBuildPhases, type BuildPhase, type BuildPhaseName } from "./build-phases.ts";
import type { HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import {
  heroPropsOf,
  trimMeshesOf,
  type HeroPropRecord,
  type TrimMeshRecord,
} from "./hero-prop-placement.ts";
import { layoutMap, type PartRecord, type Vector } from "./map-layout.ts";
import { relationMapSpecSchema, type MapSpec, type TerrainFill } from "./map-spec.ts";
import {
  ambientEffectsOf,
  missingSpriteWarnings,
  type AmbientEffectRecord,
} from "./ambient-effects.ts";
import { recordedSprites, spriteSizePixels } from "../lighting/ambient-sprites.ts";
import { heroAssetsFile } from "../hero-props/hero-asset-store.ts";
import { terrainChunks } from "./terrain-heightmap.ts";
import { placeArrangements } from "./arrangement-placement.ts";
import { placeProps, type PropKind, type PropRecord } from "./prop-placement.ts";
import { placeSetPieces } from "./set-piece-placement.ts";
import { doorwayClearanceBoxes } from "./size-rules.ts";
import { buildFacades } from "./facade-grammar.ts";
import { buildRoomDetails, type DetailPart } from "./room-details.ts";
import { resolveRelations } from "./relation-solver.ts";

const presets = await loadPresets();

const propGeneratorDirectory = new URL("../../luau/props/", import.meta.url);

const idleScriptFile = new URL("../../luau/idle-animation.luau", import.meta.url);

const vectorSchema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const boundsSchema = z.strictObject({ min: vectorSchema, max: vectorSchema });

const buildMapInput = relationMapSpecSchema.safeExtend({
  /** Which Studio builds the map; optional while exactly one is connected. */
  studioId: z.string().min(1).optional(),
  /**
   * Uses the recorded asset ids (hero props, trim meshes, ambient sprites and the baked maps of material
   * variants) that belong to the author's own places. Off by default: those ids do not load for other
   * users, so the map is built from Luau generators and plain materials, with no missing-asset warnings.
   */
  useRecordedAssets: z.boolean().default(false),
});

const buildMapOutput = z.strictObject({
  mapId: z.string(),
  partCount: z.number().int(),
  /** The seven build phases in the order they ran, each with the number of parts it built. */
  phases: z.array(z.strictObject({ name: z.string(), partCount: z.number().int() })),
  bounds: boundsSchema,
  zones: z.array(
    z.strictObject({ name: z.string(), partCount: z.number().int(), bounds: boundsSchema }),
  ),
  /** One line per set piece skipped because its room has no space for it, per hero prop not built and why, per hero asset that failed to load and per ambient sprite with no recorded asset. */
  warnings: z.array(z.string()),
  /**
   * Look problems of the plan, found before Studio is touched; they warn and never fail a build. Only walkway
   * and doorway issues carry a `suggestedSpecPatch`, a JSON merge patch of this tool's input.
   */
  lookIssues: z.array(
    z.strictObject({
      kind: z.enum([...lookIssueKinds, ...paletteIssueKinds]),
      zone: z.string(),
      detail: z.string(),
      suggestedSpecPatch: z
        .strictObject({ rooms: z.array(z.record(z.string(), z.unknown())) })
        .optional(),
    }),
  ),
  /** Pixels of the plan's distinct material-map images (at the baked map size) and ambient sprites, each counted once; 0 with recorded assets off. */
  texturePixels: z.number().int(),
});

/** What `build-map.luau` reports after a phase: the parts in the Model; the shell phase also says whether it replaced a map. */
const builtPhaseSchema = z.strictObject({
  partCount: z.number().int(),
  replaced: z.boolean().optional(),
  /** The props phase lists each hero asset that failed to load; its set piece was built instead. */
  heroLoadFailures: z
    .array(z.strictObject({ kind: z.string(), assetId: z.string(), error: z.string() }))
    .optional(),
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
  if (fill.shape !== "ball") {
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
function variantsOf(
  style: Preset | undefined,
  useRecordedAssets: boolean,
): Record<string, Variant> {
  const variants: Record<string, Variant> = {};
  for (const [role, surface] of Object.entries(style?.surfaces ?? {})) {
    if (surface.variant === undefined) continue;
    // Without recorded assets a variant renders flat color only: its baked maps are dropped.
    variants[role] = useRecordedAssets ? surface.variant : { ...surface.variant, maps: undefined };
  }
  return variants;
}

/** The pixels of the distinct material-map images of `variants` and of the distinct sprite textures of `effects`. */
function texturePixelsOf(
  variants: Record<string, Variant>,
  effects: AmbientEffectRecord[],
): number {
  const mapImages = new Set(
    Object.values(variants).flatMap((variant) => Object.values(variant.maps ?? {})),
  );
  const sprites = new Set(effects.flatMap((effect) => effect.texture ?? []));
  return mapImages.size * materialMapSize ** 2 + sprites.size * spriteSizePixels ** 2;
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

/** The terrain materials the style draws with a role's variant, as `{ material, role }`; a role whose variant has another base material is left out. */
function terrainOverridesOf(
  style: Preset | undefined,
  variants: Record<string, Variant>,
): { material: string; role: string }[] {
  return Object.entries(style?.terrainVariants ?? {})
    .filter(([material, role]) => variants[role]?.baseMaterial === material)
    .map(([material, role]) => ({ material, role }));
}

/** What every phase of one build shares. */
interface BuildContext {
  mapId: string;
  terrainFills: TerrainFill[];
  variants: Record<string, Variant>;
  terrainOverrides: { material: string; role: string }[];
  generators: Record<string, string>;
  /** The hero props the props phase loads from their assets, beside the set pieces left in `props`. */
  heroProps: HeroPropRecord[];
  /** The profile meshes that replace trim boxes, loaded like hero props with the box as their fallback. */
  trimMeshes: TrimMeshRecord[];
  /** Every material name of the build, checked by the shell phase before anything is built. */
  materials: string[];
  /** The style's idle sway of each prop kind the map places, and the server Script source that runs it; absent when none applies. */
  idle?: { idleAnimations: Record<string, IdleAnimation>; idleScript: string };
}

/** The style's idle animations of the prop kinds in `props`, with the Script source; undefined when none applies. */
async function idleOf(
  style: Preset | undefined,
  props: PropRecord[],
): Promise<BuildContext["idle"]> {
  const kinds = new Set(props.map((prop) => prop.kind));
  const idleAnimations = Object.fromEntries(
    Object.entries(style?.idleAnimations ?? {}).filter(([kind]) => kinds.has(kind as PropKind)),
  );
  if (Object.keys(idleAnimations).length === 0) {
    return undefined;
  }
  return { idleAnimations, idleScript: await readFile(idleScriptFile, "utf8") };
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
      terrainOverrides: build.terrainOverrides,
      materials: build.materials,
    },
    "floors and ceilings": {
      parts: phase.parts,
      variants: build.variants,
      ceilingTag: config.ceilingTag,
    },
    openings: { parts: phase.parts, variants: build.variants },
    surfaces: { parts: phase.parts, variants: build.variants },
    props: {
      props: phase.parts,
      generators: build.generators,
      noShadowSizeStuds: config.noShadowPropSizeStuds,
      heroProps: [...build.heroProps, ...build.trimMeshes],
      ...build.idle,
    },
    lighting: {
      lights: phase.parts,
      ceilingTag: config.ceilingTag,
      ceilingDropStuds: config.lightCeilingDropStuds,
      fixtureSizeStuds: config.lightFixtureSizeStuds,
    },
    "ambient effects": { effects: phase.parts },
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
    ...terrainFills.flatMap((fill) =>
      fill.shape === "heightmap" ? [fill.material, ...Object.values(fill.layers)] : [fill.material],
    ),
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

/** A generator attribute name prefix of a prop slot: `frame` is `Frame`, so its attributes are `FrameColor` and `FrameMaterial`. */
function slotAttributeName(slot: string): string {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

/**
 * The prop with `<Slot>Color` and `<Slot>Material` attributes for every preset prop slot; the kind's surface
 * role, unless exempt, overrides the `frame` slot.
 */
function withSlots(prop: StyledPropRecord, style: Preset): StyledPropRecord {
  const looks = { ...style.propSlots };
  const role = style.propRules[prop.kind]?.surface;
  if (role !== undefined && role !== "exempt") {
    looks.frame = style.surfaces[role];
  }
  const attributes: Record<string, string> = { ...prop.attributes };
  for (const [slot, look] of Object.entries(looks)) {
    attributes[`${slotAttributeName(slot)}Color`] = look.color;
    attributes[`${slotAttributeName(slot)}Material`] = look.material;
  }
  return { ...prop, attributes };
}

/**
 * The props of a styled map: kit props in plain rooms, and in typed rooms the set pieces of their room type
 * followed by its arrangements, which would collide with random kit props; warnings name each set piece
 * skipped for lack of space and each arrangement that placed nothing; each prop carries the preset's
 * slot colors and materials as attributes, its surface role overriding `frame`.
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
    style.propRules,
  );
  const arrangements = placeArrangements(spec, style.roomTypes, setPieces.pieces, seed);
  return {
    props: [
      ...placeProps(plainSpec, style.propKit, seed),
      ...setPieces.pieces,
      ...arrangements.pieces,
    ].map((prop) => withSlots(prop, style)),
    warnings: [...setPieces.warnings, ...arrangements.warnings],
  };
}

/** The stored preset of `name`, which resolveStyle has already found. */
function presetNamed(name: string): Preset {
  const preset = presets.get(name);
  if (preset === undefined) throw new Error(`Unknown style preset "${name}".`);
  return preset;
}

/** Builds the map phase by phase; `heroSources` says where recorded hero assets are looked up. */
async function buildMap(
  input: z.output<typeof buildMapInput>,
  context: ToolContext,
  heroSources: HeroPropSources,
) {
  // Resolving relations and the style and laying out first keep a spec that cannot be built from touching Studio.
  const spec = resolveRelations(input);
  const style = spec.style === undefined ? undefined : resolveStyle(presets, spec.style);
  rejectUnknownRoomTypes(spec, style);
  // A style is the switch for the decor: ceilings, trim details, floor tile patterns and props come with a
  // preset, never without. Ceilings get no tile pattern, so capture_zones' cutaway still opens every room.
  const layout = layoutMap(spec, style?.surfaces, { ceilings: style !== undefined });
  const details: DetailPart[] =
    style === undefined ? [] : buildRoomDetails(spec, layout.parts, style.surfaces, ["floor"]);
  const facades = style === undefined ? [] : buildFacades(spec, layout.parts, style.surfaces);
  const placed = style === undefined ? { props: [], warnings: [] } : propsOf(spec, style);
  const heroes =
    style === undefined || spec.style === undefined || !input.useRecordedAssets
      ? { props: placed.props, heroProps: [], warnings: [] }
      : await heroPropsOf(
          spec,
          { name: spec.style.preset, base: presetNamed(spec.style.preset), style },
          placed.props,
          heroSources,
        );
  const { props, heroProps } = heroes;
  const trim =
    style === undefined || spec.style === undefined || !input.useRecordedAssets
      ? { details, trimMeshes: [] }
      : await trimMeshesOf(details, { base: presetNamed(spec.style.preset), style }, heroSources);
  const { trimMeshes } = trim;
  const warnings = [...placed.warnings, ...heroes.warnings];
  // Palette issues use the kinds the look lint's own union lacks, so both lists merge into the output's union.
  const lookIssues =
    style === undefined
      ? []
      : [...findLookIssues(spec, placed.props, style), ...lintPalette(style)];
  const heroSurfaces = heroProps.flatMap((hero) => Object.values(hero.surfaces));
  // A hero prop whose asset fails to load builds its fallback set piece, so its kind needs a generator too.
  const generators = await generatorsOf([...props, ...heroProps.map((hero) => hero.fallback)]);
  const variants = variantsOf(style, input.useRecordedAssets);
  const lights = lightRecordsOf(spec, layout.parts, style);
  const effectSpecs = style?.ambientEffects ?? [];
  const spriteTextures =
    effectSpecs.length === 0 || !input.useRecordedAssets
      ? {}
      : await recordedSprites(heroSources.assetsFile ?? heroAssetsFile);
  const effects: AmbientEffectRecord[] = ambientEffectsOf(
    spec,
    layout.parts,
    effectSpecs,
    spriteTextures,
  );
  if (input.useRecordedAssets) {
    warnings.push(
      ...missingSpriteWarnings(
        effectSpecs.filter((effect) => effects.some((record) => record.name === effect.name)),
        spriteTextures,
      ),
    );
  }
  const build: BuildContext = {
    mapId: input.mapId,
    terrainFills: layout.terrainFills,
    variants,
    terrainOverrides: terrainOverridesOf(style, variants),
    generators,
    heroProps,
    trimMeshes,
    idle: await idleOf(style, [...props, ...heroProps.map((hero) => hero.fallback)]),
    materials: materialsOf(
      [...layout.parts, ...details, ...facades, ...heroSurfaces],
      layout.terrainFills,
      variants,
    ),
  };
  // Heightmaps are generated before Studio is touched; the shell phase records them, then their chunks are written.
  const chunks = layout.terrainFills.flatMap((fill) =>
    fill.shape === "heightmap" ? terrainChunks(fill, spec.seed ?? config.defaultSeed) : [],
  );
  const studioId = await selectStudio(context.studio, input.studioId);
  const phases = groupBuildPhases({
    parts: layout.parts,
    details: trim.details,
    facades,
    props,
    lights,
    effects,
  });
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
      if (phase.name === "shell") {
        for (const terrainChunk of chunks) {
          await runLuauFile({
            connection: context.studio,
            studioId,
            fileName: "build-map.luau",
            datamodelType: "Edit",
            arguments: {
              phase: "terrain",
              mapId: input.mapId,
              mapsFolderName: config.mapsFolderName,
              terrainChunk,
            },
            resultSchema: builtPhaseSchema,
          });
        }
      }
      for (const failure of built.heroLoadFailures ?? []) {
        const fallback = heroProps.find((hero) => hero.assetId === failure.assetId)?.fallback.kind;
        if (fallback === undefined && trimMeshes.some((mesh) => mesh.assetId === failure.assetId)) {
          warnings.push(
            `Trim mesh ${failure.kind} (asset ${failure.assetId}) failed to load: ${failure.error}; its trim box is built instead.`,
          );
          continue;
        }
        warnings.push(
          `Hero prop ${failure.kind} (asset ${failure.assetId}) failed to load: ${failure.error}; its ${fallback ?? "set piece"} set piece is built instead.`,
        );
      }
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
    ...[...layout.parts, ...details, ...facades].map((part) =>
      boundsOfBox(part.position, part.size),
    ),
    ...layout.terrainFills.map(boundsOfFill),
  ]);
  return toolResult({
    mapId: input.mapId,
    partCount,
    phases: phases.map((phase) => ({
      name: phase.name,
      partCount:
        phase.parts.length + (phase.name === "props" ? heroProps.length + trimMeshes.length : 0),
    })),
    bounds,
    zones: zonesOf([...layout.parts, ...details, ...facades]),
    warnings,
    lookIssues,
    texturePixels: texturePixelsOf(variants, effects),
  });
}

/** build_map with its recorded hero assets looked up through `heroSources`, so a test can fake the record. */
export function buildMapToolWith(heroSources: HeroPropSources): typeof buildMapTool {
  return { ...buildMapTool, handler: (input, context) => buildMap(input, context, heroSources) };
}

export const buildMapTool: ToolDefinition<typeof buildMapInput, typeof buildMapOutput> = {
  name: "build_map",
  title: "Build map",
  description:
    `Builds a map from a data spec in the open place: per room an anchored floor, walls with door gaps and an optional SpawnLocation, plus terrain fills. With a style each room also gets a ceiling (tagged ${config.ceilingTag}, not colliding), baseboard, crown, stripe, pillar and arch details in the preset's trim and accent colors (none collide) and props from the preset's kit, each a ProceduralModel that shares one generator ModuleScript per kind in the map Model and is generated before the build returns; without a style none of these are built. A styled room marked exterior (optionally with facadeFloors storeys) also gets a facade on the outer face of its walls: an accent band between storeys, a framed window per bay and storey and a trim cornice, none colliding. A room gives its center (x, z) or a relation { to, direction, hallwayLength, hallwayWidth } that sets it beside another room on the 5-stud grid, joined by a hallway room named "<to>-<room>-hallway" that is one more zone. An optional style { preset, overrides } names a genre preset, is checked before Studio is asked, paints parts in its palette colors and materials, hangs point lights from its light roles under each room's floor (each light within ${String(config.lightCeilingDropStuds)} stud of a ceiling also gets a ${String(config.lightFixtureSizeStuds)}-stud Neon fixture part against the ceiling, tagged ${config.ceilingTag} so it hides with the ceilings), applies its lighting recipe to Lighting (the previous values are stored on the map Model for restore) and gives a role that names a MaterialVariant one flat MaterialVariant in MaterialService, named after the map and role and reused on rebuild; an optional seed defaults to ${String(config.defaultSeed)}. ` +
    `Recorded assets are off by default: with useRecordedAssets false (the default) hero props, trim meshes, ambient sprite textures and the baked maps of MaterialVariants are all skipped, the map is built from Luau generators and plain materials and no missing-asset or missing-sprite warning is returned. Set useRecordedAssets true only for the author's own places, where those ids load; the rest of this paragraph and the next two describe that mode. ` +
    `A room type that lists hero props gets each one's uploaded asset, found by recipe hash in hero-assets.json, in place of the set piece it replaces: loaded with InsertService, scaled to its recipe size, its MeshParts colored from the surface role each is named after, anchored and not colliding. build_map only reads recorded assets and never uploads; an asset that fails to load builds the set piece instead with a warning naming the asset id and error; a hero prop with no recorded asset keeps its set piece and a warning says to generate and upload it from a clone of the roblox-kit repo. Each other prop whose kind's prop-<kind> recipe has a recorded asset is that mesh instead, stretched on each axis to the prop's box; a kind with no recorded asset keeps its ProceduralModel, with no warning. ` +
    `The map is one Model named mapId under Workspace.${config.mapsFolderName}, and mapId is the handle that later tools take. ` +
    `The handle lasts while that Model exists in the open place, including across calls and saves. Calling build_map again with the same mapId ` +
    `replaces the Model and clears the terrain its previous build filled. A terrain fill of shape heightmap { center, size, material, layers, seed, noiseScaleStuds, erosion } is seeded fractal noise with particle hydraulic erosion inside its box (minimum corner and size on the 4-stud voxel grid, size.y the tallest height above the box bottom), written with WriteVoxels in chunks after the shell phase: sand low, snow high, rock on steep slopes, grass elsewhere, and the fill's material below. Studio may not offer an undo step (undo recording is unavailable to execute_luau). ` +
    `A style with ambientEffects also gets, per room of a listed type (or every room), a ParticleEmitter at the floor's center or a Beam across the room from west to east under Attachments on the floor part, textured with its sprite (drawn by the repo's own code and recorded by hash in hero-assets.json); a sprite with no recorded asset builds its emitters untextured with a warning. A style with idleAnimations also gives each set piece of a listed kind sway attributes and the map one server Script that sways them about the top or bottom of their box during play. The build runs in seven phases (shell, floors and ceilings, openings, surfaces, props, lighting, ambient effects), reporting progress after each; a phase that fails stops the build and may leave a partial Model, which building again with the same mapId replaces. ` +
    `Returns { mapId, partCount, phases, bounds, zones, warnings, lookIssues, texturePixels }: the parts per phase, the studs bounds of the whole map and of each room (zone), one warning per set piece skipped because its room has no space for it, and one per hero prop not built, saying why, and one per hero asset that fails to load (its set piece is built instead), and one per ambient sprite with no recorded asset; lookIssues lists plan-time look problems of a styled map (prop scale, dead gaps, walkway and doorway widths, prop facing and density, colors outside the palette, too little lightness separation between floor, wall, ceiling and trim), computed before Studio is touched, warning only and never failing the build, where walkway and doorway issues carry a suggestedSpecPatch, a JSON merge patch of this input; texturePixels is the pixel count of the plan's distinct material-map images (at the baked map size) and ambient sprites, each counted once, 0 with recorded assets off.`,
  inputSchema: buildMapInput,
  outputSchema: buildMapOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: (input, context) => buildMap(input, context, {}),
};
