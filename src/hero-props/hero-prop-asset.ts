import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.ts";
import { heroParts, type Preset } from "../style/preset-schema.ts";
import { heroAssetsFile, readHeroAssets } from "./hero-asset-store.ts";
import {
  lookUpOpenCloudCredentials,
  type OpenCloudCredentialsLookup,
} from "./open-cloud-credentials.ts";
import { uploadReviewedHeroProp, type OpenCloudTransport } from "./open-cloud-upload.ts";
import { scriptedMeshHash } from "./generate-scripted-mesh.ts";
import { heroRecipeOf } from "./prop-recipes.ts";
import { recipeHash } from "./recipe-hash.ts";

const heroGeneratorScript = new URL("./generate-hero-prop.py", import.meta.url);
const defaultHeroPropsDirectory = new URL(`../../${config.heroPropsFolder}/`, import.meta.url);
const reviewFileName = "review.json";

/** Where build_map looks up a hero prop's recorded asset; it reads nothing else and uploads nothing. */
export interface HeroPropSources {
  /** The record of uploaded hero props by recipe hash; defaults to the committed `hero-assets.json`. */
  assetsFile?: URL;
}

/** Where the upload script finds a hero prop's record, generated folders, credentials and Open Cloud calls. */
export interface HeroPropUploadSources extends HeroPropSources {
  /** The folder of generated `<preset>-<kind>-<hash>` folders, each with its `review.json`. */
  heroPropsDirectory?: URL;
  /** Asked only when a reviewed hero prop has no recorded upload; defaults to the environment and key files. */
  credentials?: () => Promise<OpenCloudCredentialsLookup>;
  transport?: OpenCloudTransport;
}

/** The asset of a hero prop's recipe hash, or why it has none; a failed upload carries its error message. */
export type HeroPropAsset = { hash: string } & (
  | { status: "recorded" | "uploaded"; assetId: string }
  | { status: "unreviewed" }
  | { status: "no-credentials"; missing: string }
  | { status: "upload-failed"; error: string }
);

/**
 * The recipe hash of the preset's hero prop of `kind` (its own, or a `prop-<kind>` recipe), repeating the
 * computation in `generateHeroProp`: the recipe and each part role's surface color, hashed with the generator's source.
 * A declared mesh hashes its script instead, as in `scriptedMeshHash`.
 */
export async function heroRecipeHash(preset: Preset, kind: string): Promise<string> {
  const declaration = preset.meshes?.[kind];
  if (declaration !== undefined) return scriptedMeshHash(kind, declaration);
  const recipe = heroRecipeOf(preset, kind);
  if (recipe === undefined) throw new Error(`The preset has no hero prop "${kind}".`);
  const roleColors: Record<string, string> = {};
  for (const part of heroParts(recipe.operations)) {
    roleColors[part.shape.role] = preset.surfaces[part.shape.role].color;
  }
  return recipeHash({ recipe, roleColors }, await readFile(heroGeneratorScript, "utf8"));
}

const reviewSchema = z.object({ hash: z.string(), passed: z.boolean() });

/** Whether the generated folder holds a passed review for `hash`; a missing file is none. */
async function hasPassedReview(folder: URL, hash: string): Promise<boolean> {
  try {
    const file = new URL(reviewFileName, folder);
    const review = reviewSchema.parse(JSON.parse(await readFile(file, "utf8")));
    return review.passed && review.hash === hash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * The recorded asset of the preset's hero prop of `kind`, found by its recipe hash: a read-only lookup that
 * never uploads. `assetId` is undefined when no upload is recorded for the hash.
 */
export async function recordedHeroAsset(
  preset: Preset,
  kind: string,
  sources: HeroPropSources = {},
): Promise<{ hash: string; assetId: string | undefined }> {
  const hash = await heroRecipeHash(preset, kind);
  const recorded = (await readHeroAssets(sources.assetsFile ?? heroAssetsFile))[hash];
  return { hash, assetId: recorded?.kind === kind ? recorded.assetId : undefined };
}

/**
 * The asset of the stored preset's hero prop of `kind`, for `scripts/upload-hero-props.ts` only: the recorded
 * upload of its recipe hash, else, when its review passed and credentials are found, a fresh upload that
 * `uploadReviewedHeroProp` records. An upload that fails is returned as `upload-failed`; a malformed creator
 * throws.
 */
export async function heroPropAsset(
  presetName: string,
  preset: Preset,
  kind: string,
  sources: HeroPropUploadSources = {},
): Promise<HeroPropAsset> {
  const assetsFile = sources.assetsFile ?? heroAssetsFile;
  const { hash, assetId } = await recordedHeroAsset(preset, kind, sources);
  if (assetId !== undefined) return { hash, status: "recorded", assetId };
  const folder = new URL(
    `${presetName}-${kind}-${hash}/`,
    sources.heroPropsDirectory ?? defaultHeroPropsDirectory,
  );
  if (!(await hasPassedReview(folder, hash))) return { hash, status: "unreviewed" };
  const lookup = await (sources.credentials ?? lookUpOpenCloudCredentials)();
  if ("missing" in lookup) return { hash, status: "no-credentials", missing: lookup.missing };
  try {
    const assetId = await uploadReviewedHeroProp(
      kind,
      hash,
      folder,
      lookup.credentials,
      sources.transport,
      assetsFile,
    );
    return { hash, status: "uploaded", assetId };
  } catch (error) {
    return {
      hash,
      status: "upload-failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
