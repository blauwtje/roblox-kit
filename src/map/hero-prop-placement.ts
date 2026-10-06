import { recordedHeroAsset, type HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import {
  propRecipeKind,
  propRecipes,
  trimRecipeKind,
  type TrimProfileKind,
} from "../hero-props/prop-recipes.ts";
import { heroParts, type MeshDeclaration, type Preset } from "../style/preset-schema.ts";
import type { Vector } from "./map-layout.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
import type { DetailPart } from "./room-details.ts";
import { roomBounds, type PropRecord } from "./prop-placement.ts";
import { doorwayClearanceBoxes, type DoorwayClearanceBox } from "./size-rules.ts";

type HeroPropRecipe = NonNullable<Preset["heroProps"]>[string];
type SurfaceRole = keyof Preset["surfaces"];

/** A placed prop as `build-map.luau` takes it: a set piece also turns by `yaw` and carries `attributes`. */
type PlacedProp = PropRecord & { yaw?: number; attributes?: Record<string, string> };

/**
 * One hero prop for `build-map.luau`: the uploaded asset loaded in the slot of the set piece it replaces.
 * `pivot` is the center of its box, `size` the recipe's width, height and depth in studs (x, y, z), `yaw`
 * the replaced piece's turn about Y, and `surfaces` the color and material of each role a MeshPart is named after.
 * `fallback` is the replaced set piece, which `build-map.luau` builds instead when the asset fails to load.
 * `bevels` is the bevel in studs of each role's mesh (the smallest of its shapes, 0 when a shape has none), which `build-map.luau` sets on the MeshPart for `check_map`.
 * `fit` "stretch" (a prop kind's mesh) scales the asset to `size` on each axis, in place of scaling it evenly to `size.x`;
 * "none" (a declared mesh) keeps the asset's modelled size, and then `anchor` says what `pivot` is: the
 * mesh's bottom centre ("bottom") or its box centre ("center"), and `part` names the one MeshPart to keep.
 */
export interface HeroPropRecord {
  kind: string;
  assetId: string;
  pivot: Vector;
  yaw: number;
  size: Vector;
  surfaces: Record<string, { color: string; material: string }>;
  bevels: Record<string, number>;
  fallback: PlacedProp;
  fit?: "stretch" | "none";
  anchor?: "bottom" | "center";
  part?: string;
}

/** The preset, the style resolved from it, and the preset's name, which names the generated folders. */
export interface HeroPreset {
  name: string;
  /** The preset as stored: the recipe hash is computed from it, as `generate-hero-prop.ts` does. */
  base: Preset;
  /** The resolved style: its surfaces color the meshes. */
  style: Preset;
}

function isInRoom(pivot: Vector, room: RoomSpec): boolean {
  return (
    Math.abs(pivot.x - room.x) <= room.width / 2 && Math.abs(pivot.z - room.z) <= room.depth / 2
  );
}

/**
 * Whether the hero prop's footprint, turned by the replaced piece's yaw about its pivot, stays inside the
 * room's walls and out of every doorway clearance box. The replaced piece fit, but a hero prop is often bigger.
 */
function heroFits(
  spec: MapSpec,
  room: RoomSpec,
  record: HeroPropRecord,
  clearances: DoorwayClearanceBox[],
): boolean {
  const turn = (record.yaw * Math.PI) / 180;
  const cos = Math.abs(Math.cos(turn));
  const sin = Math.abs(Math.sin(turn));
  const halfX = (record.size.x * cos + record.size.z * sin) / 2;
  const halfZ = (record.size.x * sin + record.size.z * cos) / 2;
  const { x, z } = record.pivot;
  const interior = roomBounds(spec, room);
  const inside =
    Math.abs(x - room.x) + halfX <= interior.halfWidth &&
    Math.abs(z - room.z) + halfZ <= interior.halfDepth;
  return (
    inside &&
    clearances.every(
      (box) =>
        x + halfX <= box.min.x ||
        x - halfX >= box.max.x ||
        z + halfZ <= box.min.z ||
        z - halfZ >= box.max.z,
    )
  );
}

/** The color and material of each surface role the recipe's parts are named after. */
function recipeSurfaces(recipe: HeroPropRecipe, style: Preset): HeroPropRecord["surfaces"] {
  const surfaces: HeroPropRecord["surfaces"] = {};
  for (const role of new Set<SurfaceRole>(
    heroParts(recipe.operations).map((part) => part.shape.role),
  )) {
    const { color, material } = style.surfaces[role];
    surfaces[role] = { color, material };
  }
  return surfaces;
}

/** The bevel of each role's mesh: the smallest `bevel` among its shapes, 0 when any shape has none. */
function recipeBevels(recipe: HeroPropRecipe): HeroPropRecord["bevels"] {
  const bevels: HeroPropRecord["bevels"] = {};
  for (const { shape } of heroParts(recipe.operations)) {
    bevels[shape.role] = Math.min(bevels[shape.role] ?? Infinity, shape.bevel ?? 0);
  }
  return bevels;
}

/**
 * The record that puts a prop kind's mesh in the piece's own box, stretched to it on each axis. The piece's box
 * is in its own frame (before its yaw); when its long side runs the other way from the recipe's width, the mesh
 * turns a further 90 degrees and takes the box with x and z swapped, so it fills the same footprint.
 */
function stretchedRecord(
  assetId: string,
  recipe: HeroPropRecipe,
  piece: PlacedProp,
  style: Preset,
): HeroPropRecord {
  const { width, depth } = recipe.size;
  const turned = width >= depth !== piece.size.x >= piece.size.z;
  const { x, y, z } = piece.size;
  return {
    kind: piece.kind,
    assetId,
    pivot: piece.pivot,
    yaw: ((piece.yaw ?? 0) + (turned ? 90 : 0)) % 360,
    size: turned ? { x: z, y, z: x } : { x, y, z },
    surfaces: recipeSurfaces(recipe, style),
    bevels: recipeBevels(recipe),
    fallback: piece,
    fit: "stretch",
  };
}

/** The record that stands the hero prop where the replaced piece stood: same x, z and yaw, on the same base. */
function heroRecord(
  kind: string,
  assetId: string,
  recipe: HeroPropRecipe,
  piece: PlacedProp,
  style: Preset,
): HeroPropRecord {
  const { width, height, depth } = recipe.size;
  const surfaces = recipeSurfaces(recipe, style);
  const base = piece.pivot.y - piece.size.y / 2;
  return {
    kind,
    assetId,
    pivot: { x: piece.pivot.x, y: base + height / 2, z: piece.pivot.z },
    yaw: piece.yaw ?? 0,
    size: { x: width, y: height, z: depth },
    surfaces,
    bevels: recipeBevels(recipe),
    fallback: piece,
  };
}

/**
 * The hero props of a styled map, each in the slot of the set piece its recipe `replaces` in a room whose
 * type lists it, and the props without the pieces they replace. Only recorded uploads are read; nothing is
 * uploaded. A hero prop whose recipe hash has no recorded asset leaves its set piece in place, with a warning
 * saying to generate and upload it from a clone of the roblox-kit repo. A room with no such set piece
 * gets a warning and no hero prop, and so does one whose hero prop would reach through a wall or into a doorway.
 * A prop a declared mesh (the preset's `meshes`) replaces becomes that mesh first, so no hero prop sees it.
 * Then every remaining prop whose kind's `prop-<kind>` recipe has a recorded asset becomes that mesh, stretched to
 * the prop's box; a kind with no recorded asset keeps its Luau model, with no warning.
 */
export async function heroPropsOf<Prop extends PlacedProp>(
  spec: MapSpec,
  preset: HeroPreset,
  props: Prop[],
  sources: HeroPropSources = {},
): Promise<{ props: Prop[]; heroProps: HeroPropRecord[]; warnings: string[] }> {
  const { style } = preset;
  const declared = await declaredMeshesOf(preset, props, sources);
  props = declared.props;
  const rooms = spec.rooms.flatMap((room) => {
    const kinds =
      room.roomType === undefined ? undefined : style.roomTypes?.[room.roomType]?.heroProps;
    return kinds === undefined ? [] : [{ room, kinds }];
  });

  const agent = { radius: style.sizeRules.agentRadius, height: style.sizeRules.agentHeight };
  const clearances = doorwayClearanceBoxes(spec, agent);
  const replaced = new Set<Prop>();
  const heroProps: HeroPropRecord[] = [];
  const warnings: string[] = [];
  for (const { room, kinds } of rooms) {
    for (const kind of kinds) {
      const recipe = style.heroProps?.[kind];
      if (recipe === undefined) {
        throw new Error(
          `Room type "${String(room.roomType)}" lists hero prop "${kind}", which the style's heroProps does not declare.`,
        );
      }
      const piece = props.find(
        (prop) =>
          prop.kind === recipe.replaces && !replaced.has(prop) && isInRoom(prop.pivot, room),
      );
      if (piece === undefined) {
        warnings.push(
          `Room "${room.name}" has no ${recipe.replaces} set piece for hero prop ${kind} to replace; the hero prop is not built.`,
        );
        continue;
      }
      const { hash, assetId } = await recordedHeroAsset(preset.base, kind, sources);
      if (assetId === undefined) {
        warnings.push(
          `Room "${room.name}" keeps its ${recipe.replaces} set piece instead of hero prop ${kind} (recipe ${hash}): it has no recorded asset; generate and upload it from a clone of the roblox-kit repo.`,
        );
        continue;
      }
      const record = heroRecord(kind, assetId, recipe, piece, style);
      if (!heroFits(spec, room, record, clearances)) {
        const { width, depth } = recipe.size;
        warnings.push(
          `Room "${room.name}" keeps its ${recipe.replaces} set piece instead of hero prop ${kind}: its ${String(width)} by ${String(depth)} stud footprint does not fit inside the room clear of its doorways.`,
        );
        continue;
      }
      replaced.add(piece);
      heroProps.push(record);
    }
  }
  const meshes = await propMeshesOf(
    preset,
    props.filter((prop) => !replaced.has(prop)),
    sources,
  );
  return {
    props: meshes.props,
    heroProps: [...declared.heroProps, ...heroProps, ...meshes.heroProps],
    warnings,
  };
}

type MeshTarget = MeshDeclaration["targets"][number];

/** The record that puts a declared mesh in the piece's slot at its modelled size, turned by the piece's yaw and the target's. */
function declaredRecord(assetId: string, target: MeshTarget, piece: PlacedProp): HeroPropRecord {
  const anchor = target.anchor ?? "center";
  const { x, y, z } = piece.pivot;
  return {
    kind: piece.kind,
    assetId,
    pivot: anchor === "bottom" ? { x, y: y - piece.size.y / 2, z } : piece.pivot,
    yaw: ((piece.yaw ?? 0) + (target.yaw ?? 0)) % 360,
    size: piece.size,
    surfaces: {},
    bevels: {},
    fallback: piece,
    fit: "none",
    anchor,
    ...(target.part === undefined ? {} : { part: target.part }),
  };
}

/**
 * Each prop a declared mesh replaces (a `prop:<kind>` target, and its `label` when it has one) as that mesh at its
 * modelled size, ahead of any `heroProps` entry or `prop-<kind>` recipe for the piece. A mesh with no recorded
 * asset leaves its pieces in place, with no warning.
 */
async function declaredMeshesOf<Prop extends PlacedProp>(
  preset: HeroPreset,
  props: Prop[],
  sources: HeroPropSources,
): Promise<{ props: Prop[]; heroProps: HeroPropRecord[] }> {
  const declarations = Object.entries(preset.base.meshes ?? {});
  const assetIds = new Map<string, string | undefined>();
  const kept: Prop[] = [];
  const heroProps: HeroPropRecord[] = [];
  for (const prop of props) {
    const match = declarations.flatMap(([meshKind, { targets }]) =>
      targets
        .filter(
          (target) =>
            target.replaces === `prop:${prop.kind}` &&
            (target.label === undefined || prop.attributes?.Label === target.label),
        )
        .map((target) => ({ meshKind, target })),
    )[0];
    if (match === undefined) {
      kept.push(prop);
      continue;
    }
    if (!assetIds.has(match.meshKind)) {
      assetIds.set(
        match.meshKind,
        (await recordedHeroAsset(preset.base, match.meshKind, sources)).assetId,
      );
    }
    const assetId = assetIds.get(match.meshKind);
    if (assetId === undefined) kept.push(prop);
    else heroProps.push(declaredRecord(assetId, match.target, prop));
  }
  return { props: kept, heroProps };
}

/** Each prop whose kind's recipe has a recorded asset as its stretched mesh; the others stay Luau models. */
async function propMeshesOf<Prop extends PlacedProp>(
  preset: HeroPreset,
  props: Prop[],
  sources: HeroPropSources,
): Promise<{ props: Prop[]; heroProps: HeroPropRecord[] }> {
  const assetIds = new Map<string, string | undefined>();
  const kept: Prop[] = [];
  const heroProps: HeroPropRecord[] = [];
  for (const prop of props) {
    const kind = propRecipeKind(prop.kind);
    const recipe = propRecipes[kind];
    if (recipe === undefined) {
      kept.push(prop);
      continue;
    }
    if (!assetIds.has(kind)) {
      assetIds.set(kind, (await recordedHeroAsset(preset.base, kind, sources)).assetId);
    }
    const assetId = assetIds.get(kind);
    if (assetId === undefined) kept.push(prop);
    else heroProps.push(stretchedRecord(assetId, recipe, prop, preset.style));
  }
  return { props: kept, heroProps };
}

/** A profile mesh that replaces one trim box: its recorded asset placed like the box, with the box as its fallback. */
export interface TrimMeshRecord {
  kind: string;
  assetId: string;
  pivot: Vector;
  yaw: number;
  roll: number;
  size: Vector;
  surfaces: Record<string, { color: string; material: string }>;
  fit: "stretch";
  fallbackPart: DetailPart;
}

/**
 * A declared mesh that replaces trim details: one doorway arch (its jambs and lintel as `fallbackParts`) kept at its
 * modelled size, or one crown or baseboard run (its box as the one fallback part) stretched along the run.
 * `part` names the MeshPart of the Model to keep; the mesh's own baked look is kept, so it names no surfaces.
 */
export interface DeclaredTrimRecord {
  kind: "arch" | "crown" | "baseboard";
  assetId: string;
  pivot: Vector;
  yaw: number;
  size: Vector;
  surfaces: Record<string, never>;
  fit: "stretch" | "none";
  part: string;
  fallbackParts: DetailPart[];
}

const archPiece = /^(.*-arch-\d+)-(left|right|lintel)$/;
const bandRun = /-(crown|baseboard)-(?:north|south|east|west)-[^-]*$/;

/** The doorway arches and the crown and baseboard runs the preset's declared meshes replace, as records; the other details stay. */
export async function declaredTrimOf(
  details: DetailPart[],
  preset: { base: Preset },
  sources: HeroPropSources = {},
): Promise<{ details: DetailPart[]; declaredTrim: DeclaredTrimRecord[] }> {
  const targets = Object.entries(preset.base.meshes ?? {}).flatMap(([meshKind, { targets }]) =>
    targets.map((target) => ({ meshKind, target })),
  );
  const assetIds = new Map<string, string | undefined>();
  const assetOf = async (replaces: string) => {
    const match = targets.find(({ target }) => target.replaces === replaces);
    if (match === undefined || match.target.part === undefined) return undefined;
    if (!assetIds.has(match.meshKind)) {
      assetIds.set(
        match.meshKind,
        (await recordedHeroAsset(preset.base, match.meshKind, sources)).assetId,
      );
    }
    const assetId = assetIds.get(match.meshKind);
    return assetId === undefined ? undefined : { assetId, part: match.target.part };
  };
  const arches = new Map<string, DetailPart[]>();
  const kept: DetailPart[] = [];
  const declaredTrim: DeclaredTrimRecord[] = [];
  const archAsset = await assetOf("arch");
  for (const detail of details) {
    const piece = detail.kind === "arch" ? archPiece.exec(detail.name) : null;
    if (piece?.[1] !== undefined && archAsset !== undefined) {
      arches.set(piece[1], [...(arches.get(piece[1]) ?? []), detail]);
      continue;
    }
    const band = detail.profile === undefined ? null : bandRun.exec(detail.name);
    const bandKind = band?.[1] === "crown" || band?.[1] === "baseboard" ? band[1] : undefined;
    const asset = bandKind === undefined ? undefined : await assetOf(`band:${bandKind}`);
    if (bandKind === undefined || asset === undefined || detail.profile === undefined) {
      kept.push(detail);
      continue;
    }
    // The mesh's x runs along the wall and its profile faces local -Z; the profile's yaw turns x out of the wall.
    declaredTrim.push({
      kind: bandKind,
      assetId: asset.assetId,
      pivot: detail.position,
      yaw: (detail.profile.yaw + 270) % 360,
      size: { x: detail.profile.size.z, y: detail.profile.size.y, z: detail.profile.size.x },
      surfaces: {},
      fit: "stretch",
      part: asset.part,
      fallbackParts: [detail],
    });
  }
  for (const parts of arches.values()) {
    const [jamb, other] = parts.filter((part) => !part.name.endsWith("-lintel"));
    if (archAsset === undefined || jamb === undefined || other === undefined) {
      kept.push(...parts);
      continue;
    }
    // Centered between its jambs at half the wall's height, turned a quarter when the jambs differ in z.
    declaredTrim.push({
      kind: "arch",
      assetId: archAsset.assetId,
      pivot: {
        x: (jamb.position.x + other.position.x) / 2,
        y: jamb.position.y,
        z: (jamb.position.z + other.position.z) / 2,
      },
      yaw: Math.abs(jamb.position.z - other.position.z) > 1e-9 ? 90 : 0,
      size: jamb.size,
      surfaces: {},
      fit: "none",
      part: archAsset.part,
      fallbackParts: parts,
    });
  }
  return { details: kept, declaredTrim };
}

/**
 * Each detail with a profile whose recipe has a recorded asset as a mesh stretched along its run, and the details
 * left as boxes: the others, and every one when its profile has no recorded upload (nothing is uploaded here).
 */
export async function trimMeshesOf(
  details: DetailPart[],
  preset: { base: Preset; style: Preset },
  sources: HeroPropSources = {},
): Promise<{ details: DetailPart[]; trimMeshes: TrimMeshRecord[] }> {
  const assetIds = new Map<TrimProfileKind, string | undefined>();
  const kept: DetailPart[] = [];
  const trimMeshes: TrimMeshRecord[] = [];
  const { color, material } = preset.style.surfaces.trim;
  for (const detail of details) {
    const { profile } = detail;
    if (profile === undefined) {
      kept.push(detail);
      continue;
    }
    if (!assetIds.has(profile.kind)) {
      const recorded = await recordedHeroAsset(preset.base, trimRecipeKind(profile.kind), sources);
      assetIds.set(profile.kind, recorded.assetId);
    }
    const assetId = assetIds.get(profile.kind);
    if (assetId === undefined) {
      kept.push(detail);
      continue;
    }
    trimMeshes.push({
      kind: trimRecipeKind(profile.kind),
      assetId,
      pivot: detail.position,
      yaw: profile.yaw,
      roll: profile.roll,
      size: profile.size,
      surfaces: { trim: { color, material } },
      fit: "stretch",
      fallbackPart: detail,
    });
  }
  return { details: kept, trimMeshes };
}
