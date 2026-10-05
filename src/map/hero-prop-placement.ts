import { recordedHeroAsset, type HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import { propRecipeKind, propRecipes } from "../hero-props/prop-recipes.ts";
import { heroParts, type Preset } from "../style/preset-schema.ts";
import type { Vector } from "./map-layout.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
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
 * `fit` "stretch" (a prop kind's mesh) scales the asset to `size` on each axis, in place of scaling it evenly to `size.x`.
 */
export interface HeroPropRecord {
  kind: string;
  assetId: string;
  pivot: Vector;
  yaw: number;
  size: Vector;
  surfaces: Record<string, { color: string; material: string }>;
  fallback: PlacedProp;
  fit?: "stretch";
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
    fallback: piece,
  };
}

/**
 * The hero props of a styled map, each in the slot of the set piece its recipe `replaces` in a room whose
 * type lists it, and the props without the pieces they replace. Only recorded uploads are read; nothing is
 * uploaded. A hero prop whose recipe hash has no recorded asset leaves its set piece in place, with a warning
 * saying to generate and upload it from a clone of the roblox-kit repo. A room with no such set piece
 * gets a warning and no hero prop, and so does one whose hero prop would reach through a wall or into a doorway.
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
  return { props: meshes.props, heroProps: [...heroProps, ...meshes.heroProps], warnings };
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
