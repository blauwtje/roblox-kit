import { readFile } from "node:fs/promises";
import { config } from "../config.ts";
import { recordedHeroAsset, type HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import { heroAssetsFile } from "../hero-props/hero-asset-store.ts";
import { recordedSprites, spriteSizePixels } from "../lighting/ambient-sprites.ts";
import { placeLights } from "../lighting/light-placement.ts";
import type { FixtureBox, FixtureGlow } from "../lighting/light-placement.ts";
import { loadPresets } from "../style/load-preset.ts";
import { lintPalette, type PaletteIssue } from "../style/palette-lint.ts";
import { materialMapSize, type IdleAnimation, type Preset } from "../style/preset-schema.ts";
import { resolveStyle } from "../style/resolve-style.ts";
import {
  ambientEffectsOf,
  missingSpriteWarnings,
  type AmbientEffectRecord,
} from "./ambient-effects.ts";
import { placeArrangements } from "./arrangement-placement.ts";
import { groupBuildPhases, type BuildPhase } from "./build-phases.ts";
import { buildFacades } from "./facade-grammar.ts";
import {
  declaredTrimOf,
  heroPropsOf,
  trimMeshesOf,
  type DeclaredTrimRecord,
  type HeroPropRecord,
  type TrimMeshRecord,
} from "./hero-prop-placement.ts";
import { findLookIssues, type LookIssue } from "./look-lint.ts";
import { layoutMap, type PartRecord, type Vector } from "./map-layout.ts";
import type { MapSpec, RelationMapSpec, TerrainFill } from "./map-spec.ts";
import { placeProps, type PropKind, type PropRecord } from "./prop-placement.ts";
import { resolveRelations } from "./relation-solver.ts";
import { buildRoomDetails, type DetailPart } from "./room-details.ts";
import { placeSetPieces } from "./set-piece-placement.ts";
import { doorwayClearanceBoxes } from "./size-rules.ts";
import { terrainChunks, type TerrainChunk } from "./terrain-heightmap.ts";

const presets = await loadPresets();

const propGeneratorDirectory = new URL("../../luau/props/", import.meta.url);

const idleScriptFile = new URL("../../luau/idle-animation.luau", import.meta.url);

export type PlanInput = RelationMapSpec & {
  studioId?: string | undefined;
  useRecordedAssets: boolean;
};

export type Variant = NonNullable<Preset["surfaces"][keyof Preset["surfaces"]]["variant"]>;

export interface Bounds {
  min: Vector;
  max: Vector;
}

export interface Zone {
  name: string;
  partCount: number;
  bounds: Bounds;
}

export interface LightRecord {
  zone: string;
  part: string;
  role: string;
  position: Vector;
  range: number;
  shadows: boolean;
  fixture?: FixtureBox & { pendant: boolean };
  brightness: number;
  color: string;
}

export interface PendantMeshRecord {
  kind: "pendant";
  assetId: string;
  pivot: Vector;
  yaw: number;
  size: Vector;
  surfaces: Record<string, never>;
  fit: "none";
  anchor: "bottom" | "center";
  part?: string;
  ceilingTag: string;
}

export interface BuildContext {
  mapId: string;
  terrainFills: TerrainFill[];
  variants: Record<string, Variant>;
  terrainOverrides: { material: string; role: string }[];
  generators: Record<string, string>;
  heroProps: HeroPropRecord[];
  trimMeshes: (TrimMeshRecord | DeclaredTrimRecord)[];
  pendantMeshes: PendantMeshRecord[];
  materials: string[];
  idle?: { idleAnimations: Record<string, IdleAnimation>; idleScript: string };
}

export interface BuildPlan {
  mapId: string;
  studioId: string | undefined;
  recorded: boolean;
  lighting: Preset["lighting"] | undefined;
  build: BuildContext;
  chunks: TerrainChunk[];
  phases: BuildPhase<LightRecord>[];
  phaseSizes: { name: string; partCount: number }[];
  warnings: string[];
  lookIssues: (LookIssue | PaletteIssue)[];
  bounds: Bounds;
  zones: Zone[];
  texturePixels: number;
}

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

type RoomPart = Pick<PartRecord, "room" | "position" | "size">;

function zonesOf(parts: RoomPart[]): Zone[] {
  const partsByRoom = Map.groupBy(parts, (part) => part.room);
  return [...partsByRoom].map(([name, roomParts]) => ({
    name,
    partCount: roomParts.length,
    bounds: unionOf(roomParts.map((part) => boundsOfBox(part.position, part.size))),
  }));
}

function variantsOf(style: Preset | undefined, recorded: boolean): Record<string, Variant> {
  const variants: Record<string, Variant> = {};
  for (const [role, surface] of Object.entries(style?.surfaces ?? {})) {
    if (surface.variant === undefined) continue;
    variants[role] = recorded ? surface.variant : { ...surface.variant, maps: undefined };
  }
  return variants;
}

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

async function generatorsOf(props: PropRecord[]): Promise<Record<string, string>> {
  const generators: Record<string, string> = {};
  for (const kind of new Set(props.map((prop) => prop.kind))) {
    generators[kind] = await readFile(new URL(`${kind}.luau`, propGeneratorDirectory), "utf8");
  }
  return generators;
}

async function pendantMeshOf(preset: Preset, sources: HeroPropSources) {
  for (const [meshKind, { targets }] of Object.entries(preset.meshes ?? {})) {
    const target = targets.find((candidate) => candidate.replaces === "fixture:pendant");
    if (target === undefined) continue;
    const { assetId } = await recordedHeroAsset(preset, meshKind, sources);
    return assetId === undefined ? undefined : { assetId, target };
  }
  return undefined;
}

function pendantMeshRecordsOf(
  lights: LightRecord[],
  mesh: NonNullable<Awaited<ReturnType<typeof pendantMeshOf>>>,
): PendantMeshRecord[] {
  return lights.flatMap((light) =>
    light.fixture?.glow === undefined
      ? []
      : [
          {
            kind: "pendant" as const,
            assetId: mesh.assetId,
            pivot: light.fixture.position,
            yaw: mesh.target.yaw ?? 0,
            size: light.fixture.size,
            surfaces: {},
            fit: "none" as const,
            anchor: mesh.target.anchor ?? "center",
            ...(mesh.target.part === undefined ? {} : { part: mesh.target.part }),
            ceilingTag: config.ceilingTag,
          },
        ],
  );
}

function lightRecordsOf(request: {
  spec: MapSpec;
  parts: PartRecord[];
  style: Preset | undefined;
  glow?: FixtureGlow | undefined;
}): LightRecord[] {
  const { spec, parts, style, glow } = request;
  if (style === undefined) {
    return [];
  }
  return placeLights(spec, style.lightRoles, style.lightFixtures, glow).map((placement) => {
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

function terrainOverridesOf(
  style: Preset | undefined,
  variants: Record<string, Variant>,
): { material: string; role: string }[] {
  return Object.entries(style?.terrainVariants ?? {})
    .filter(([material, role]) => variants[role]?.baseMaterial === material)
    .map(([material, role]) => ({ material, role }));
}

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

type StyledPropRecord = PropRecord & { attributes?: Record<string, string> };

function slotAttributeName(slot: string): string {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

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
    style.heroProps,
  );
  const arrangements = placeArrangements(spec, style.roomTypes, setPieces.pieces, seed);
  return {
    props: [
      ...placeProps(plainSpec, style.propKit, { seed, weights: style.propWeights }),
      ...setPieces.pieces,
      ...arrangements.pieces,
    ].map((prop) => withSlots(prop, style)),
    warnings: [...setPieces.warnings, ...arrangements.warnings],
  };
}

function presetNamed(name: string): Preset {
  const preset = presets.get(name);
  if (preset === undefined) throw new Error(`Unknown style preset "${name}".`);
  return preset;
}

async function trimMeshesWithDeclared(
  request: { details: DetailPart[]; presetName: string; style: Preset },
  sources: HeroPropSources,
) {
  const { details, presetName, style } = request;
  const base = presetNamed(presetName);
  const declared = await declaredTrimOf(details, { base }, sources);
  const profiled = await trimMeshesOf(declared.details, { base, style }, sources);
  return {
    details: profiled.details,
    trimMeshes: [...declared.declaredTrim, ...profiled.trimMeshes],
  };
}

export async function planMap(input: PlanInput, heroSources: HeroPropSources): Promise<BuildPlan> {
  const recorded = input.useRecordedAssets;
  const spec = resolveRelations(input);
  const style = spec.style === undefined ? undefined : resolveStyle(presets, spec.style);
  rejectUnknownRoomTypes(spec, style);
  const layout = layoutMap(spec, style?.surfaces, {
    ceilings: style !== undefined,
    flushSpawn: style?.flushSpawn,
  });
  const details: DetailPart[] =
    style === undefined
      ? []
      : buildRoomDetails(spec, layout.parts, style.surfaces, style.patternSurfaces ?? ["floor"]);
  const facades = style === undefined ? [] : buildFacades(spec, layout.parts, style.surfaces);
  const placed = style === undefined ? { props: [], warnings: [] } : propsOf(spec, style);
  const heroes =
    style === undefined || spec.style === undefined || !recorded
      ? { props: placed.props, heroProps: [], warnings: [] }
      : await heroPropsOf(
          spec,
          { name: spec.style.preset, base: presetNamed(spec.style.preset), style },
          placed.props,
          heroSources,
        );
  const { props, heroProps } = heroes;
  const trim: { details: DetailPart[]; trimMeshes: (TrimMeshRecord | DeclaredTrimRecord)[] } =
    style === undefined || spec.style === undefined || !recorded
      ? { details, trimMeshes: [] }
      : await trimMeshesWithDeclared(
          { details, presetName: spec.style.preset, style },
          heroSources,
        );
  const { trimMeshes } = trim;
  const warnings = [...placed.warnings, ...heroes.warnings];
  const lookIssues: BuildPlan["lookIssues"] =
    style === undefined
      ? []
      : [...findLookIssues(spec, placed.props, style), ...lintPalette(style)];
  const heroSurfaces = heroProps.flatMap((hero) => Object.values(hero.surfaces));
  const fallbacks = heroProps.flatMap((hero) =>
    hero.fallback === undefined ? [] : [hero.fallback],
  );
  const generators = await generatorsOf([...props, ...fallbacks]);
  const variants = variantsOf(style, recorded);
  const pendantMesh =
    style === undefined ||
    spec.style === undefined ||
    style.lightFixtures?.kind !== "pendant" ||
    !recorded
      ? undefined
      : await pendantMeshOf(presetNamed(spec.style.preset), heroSources);
  const lights = lightRecordsOf({
    spec,
    parts: layout.parts,
    style,
    glow: pendantMesh?.target.glow,
  });
  const pendantMeshes = pendantMesh === undefined ? [] : pendantMeshRecordsOf(lights, pendantMesh);
  const effectSpecs = style?.ambientEffects ?? [];
  const spriteTextures =
    effectSpecs.length === 0 || !recorded
      ? {}
      : await recordedSprites(heroSources.assetsFile ?? heroAssetsFile);
  const effects: AmbientEffectRecord[] = ambientEffectsOf(
    spec,
    layout.parts,
    effectSpecs,
    spriteTextures,
  );
  if (recorded) {
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
    pendantMeshes,
    idle: await idleOf(style, [...props, ...fallbacks]),
    materials: materialsOf(
      [...layout.parts, ...details, ...facades, ...heroSurfaces],
      layout.terrainFills,
      variants,
    ),
  };
  const chunks = layout.terrainFills.flatMap((fill) =>
    fill.shape === "heightmap" ? terrainChunks(fill, spec.seed ?? config.defaultSeed) : [],
  );
  const phases = groupBuildPhases({
    parts: layout.parts,
    details: trim.details,
    facades,
    props,
    lights,
    effects,
  });
  return {
    mapId: input.mapId,
    studioId: input.studioId,
    recorded,
    lighting: style?.lighting,
    build,
    chunks,
    phases,
    phaseSizes: phases.map((phase) => ({
      name: phase.name,
      partCount:
        phase.parts.length +
        (phase.name === "props" ? heroProps.length + trimMeshes.length + pendantMeshes.length : 0),
    })),
    warnings,
    lookIssues,
    bounds: unionOf([
      ...[...layout.parts, ...details, ...facades].map((part) =>
        boundsOfBox(part.position, part.size),
      ),
      ...layout.terrainFills.map(boundsOfFill),
    ]),
    zones: zonesOf([...layout.parts, ...details, ...facades]),
    texturePixels: texturePixelsOf(variants, effects),
  };
}
