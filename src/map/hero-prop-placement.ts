import { recordedHeroAsset, type HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import type { Preset } from "../style/preset-schema.ts";
import type { Vector } from "./map-layout.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
import type { PropRecord } from "./prop-placement.ts";

type HeroPropRecipe = NonNullable<Preset["heroProps"]>[string];
type SurfaceRole = keyof Preset["surfaces"];

/** A placed prop as `build-map.luau` takes it: a set piece also turns by `yaw` and carries `attributes`. */
type PlacedProp = PropRecord & { yaw?: number; attributes?: Record<string, string> };

/**
 * One hero prop for `build-map.luau`: the uploaded asset loaded in the slot of the set piece it replaces.
 * `pivot` is the center of its box, `size` the recipe's width, height and depth in studs (x, y, z), `yaw`
 * the replaced piece's turn about Y, and `surfaces` the color and material of each role a MeshPart is named after.
 * `fallback` is the replaced set piece, which `build-map.luau` builds instead when the asset fails to load.
 */
export interface HeroPropRecord {
  kind: string;
  assetId: string;
  pivot: Vector;
  yaw: number;
  size: Vector;
  surfaces: Record<string, { color: string; material: string }>;
  fallback: PlacedProp;
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

/** The record that stands the hero prop where the replaced piece stood: same x, z and yaw, on the same base. */
function heroRecord(
  kind: string,
  assetId: string,
  recipe: HeroPropRecipe,
  piece: PlacedProp,
  style: Preset,
): HeroPropRecord {
  const { width, height, depth } = recipe.size;
  const surfaces: HeroPropRecord["surfaces"] = {};
  for (const role of new Set<SurfaceRole>(recipe.parts.map((part) => part.role))) {
    const { color, material } = style.surfaces[role];
    surfaces[role] = { color, material };
  }
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
 * gets a warning and no hero prop.
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
  if (rooms.length === 0) return { props, heroProps: [], warnings: [] };

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
      replaced.add(piece);
      heroProps.push(heroRecord(kind, assetId, recipe, piece, style));
    }
  }
  return { props: props.filter((prop) => !replaced.has(prop)), heroProps, warnings };
}
