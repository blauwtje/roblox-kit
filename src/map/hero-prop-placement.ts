import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.ts";
import { heroAssetsFile, readHeroAssets, type HeroAsset } from "../hero-props/hero-asset-store.ts";
import { recipeHash } from "../hero-props/recipe-hash.ts";
import type { Preset } from "../style/preset-schema.ts";
import type { Vector } from "./map-layout.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
import type { PropRecord } from "./prop-placement.ts";

const heroGeneratorScript = new URL("../hero-props/generate-hero-prop.py", import.meta.url);
const defaultHeroPropsDirectory = new URL(`../../${config.heroPropsFolder}/`, import.meta.url);
const reviewFileName = "review.json";

type HeroPropRecipe = NonNullable<Preset["heroProps"]>[string];
type SurfaceRole = keyof Preset["surfaces"];

/**
 * One hero prop for `build-map.luau`: the uploaded asset loaded in the slot of the set piece it replaces.
 * `pivot` is the center of its box, `size` the recipe's width, height and depth in studs (x, y, z), `yaw`
 * the replaced piece's turn about Y, and `surfaces` the color and material of each role a MeshPart is named after.
 */
export interface HeroPropRecord {
  kind: string;
  assetId: string;
  pivot: Vector;
  yaw: number;
  size: Vector;
  surfaces: Record<string, { color: string; material: string }>;
}

/** Where the build looks for a hero prop's upload and review, and whether an Open Cloud key is set. */
export interface HeroPropSources {
  /** The record of uploaded hero props by recipe hash; defaults to the committed `hero-assets.json`. */
  assetsFile?: URL;
  /** The folder of generated `<preset>-<kind>-<hash>` folders, each with its `review.json`. */
  heroPropsDirectory?: URL;
  /** Defaults to whether the Open Cloud API key's environment variable is set. */
  hasApiKey?: boolean;
}

/** The preset, the style resolved from it, and the preset's name, which names the generated folders. */
export interface HeroPreset {
  name: string;
  /** The preset as stored: the recipe hash is computed from it, as `generate-hero-prop.ts` does. */
  base: Preset;
  /** The resolved style: its surfaces color the meshes. */
  style: Preset;
}

/**
 * The recipe hash of the preset's hero prop of `kind`, repeating the computation in `generateHeroProp`:
 * the recipe and each part role's surface color, hashed with the generator's source.
 */
export async function heroRecipeHash(preset: Preset, kind: string): Promise<string> {
  const recipe = preset.heroProps?.[kind];
  if (recipe === undefined) throw new Error(`The preset has no hero prop "${kind}".`);
  const roleColors: Record<string, string> = {};
  for (const part of recipe.parts) {
    roleColors[part.role] = preset.surfaces[part.role].color;
  }
  return recipeHash({ recipe, roleColors }, await readFile(heroGeneratorScript, "utf8"));
}

const reviewSchema = z.object({ hash: z.string(), passed: z.boolean() });

/** Whether the generated folder of this recipe holds a passed review for its hash; a missing file is none. */
async function hasPassedReview(directory: URL, folderName: string, hash: string): Promise<boolean> {
  try {
    const file = new URL(`${folderName}/${reviewFileName}`, directory);
    const review = reviewSchema.parse(JSON.parse(await readFile(file, "utf8")));
    return review.passed && review.hash === hash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Why a hero prop with no recorded upload is not built: no passed review, no key, or a failed upload. */
async function missingAssetReason(
  presetName: string,
  kind: string,
  hash: string,
  directory: URL,
  hasApiKey: boolean,
): Promise<string> {
  if (!(await hasPassedReview(directory, `${presetName}-${kind}-${hash}`, hash))) {
    return "it has no passed review (npm run hero-props generates, renders and reviews it)";
  }
  if (!hasApiKey) {
    return `its review passed, but ${config.openCloudApiKeyEnv} is not set, so it was never uploaded`;
  }
  return `its review passed and ${config.openCloudApiKeyEnv} is set, but hero-assets.json records no upload; the upload failed or has not run (npm run hero-props)`;
}

function isInRoom(pivot: Vector, room: RoomSpec): boolean {
  return (
    Math.abs(pivot.x - room.x) <= room.width / 2 && Math.abs(pivot.z - room.z) <= room.depth / 2
  );
}

/** The record that stands the hero prop where the replaced piece stood: same x, z and yaw, on the same base. */
function heroRecord(
  kind: string,
  asset: HeroAsset,
  recipe: HeroPropRecipe,
  piece: PropRecord & { yaw?: number },
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
    assetId: asset.assetId,
    pivot: { x: piece.pivot.x, y: base + height / 2, z: piece.pivot.z },
    yaw: piece.yaw ?? 0,
    size: { x: width, y: height, z: depth },
    surfaces,
  };
}

/**
 * The hero props of a styled map, each in the slot of the set piece its recipe `replaces` in a room whose
 * type lists it, and the props without the pieces they replace. A hero prop whose recipe hash has no
 * recorded upload leaves its set piece in place, with a warning saying why: no passed review, no API key,
 * or an upload that failed or has not run. A room with no such set piece gets a warning and no hero prop.
 */
export async function heroPropsOf<Prop extends PropRecord & { yaw?: number }>(
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

  const assets = await readHeroAssets(sources.assetsFile ?? heroAssetsFile);
  const directory = sources.heroPropsDirectory ?? defaultHeroPropsDirectory;
  const hasApiKey = sources.hasApiKey ?? Boolean(process.env[config.openCloudApiKeyEnv]);
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
      const hash = await heroRecipeHash(preset.base, kind);
      const asset = assets[hash];
      if (asset?.kind !== kind) {
        const reason = await missingAssetReason(preset.name, kind, hash, directory, hasApiKey);
        warnings.push(
          `Room "${room.name}" keeps its ${recipe.replaces} set piece instead of hero prop ${kind} (recipe ${hash}): ${reason}.`,
        );
        continue;
      }
      replaced.add(piece);
      heroProps.push(heroRecord(kind, asset, recipe, piece, style));
    }
  }
  return { props: props.filter((prop) => !replaced.has(prop)), heroProps, warnings };
}
