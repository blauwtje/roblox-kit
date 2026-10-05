import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import { materialMapNames, type MaterialRecipe } from "../style/preset-schema.ts";
import { recipeHash } from "./recipe-hash.ts";

/** The committed record of uploaded hero props and material maps, keyed by recipe hash. */
export const heroAssetsFile = new URL("./hero-assets.json", import.meta.url);

const heroAssetSchema = z.strictObject({
  kind: z.string().min(1),
  assetId: z.string().regex(/^\d+$/),
});

const heroAssetsSchema = z.record(z.string(), heroAssetSchema);

export type HeroAsset = z.output<typeof heroAssetSchema>;

/** Every recorded hero asset by recipe hash; a missing file is an empty record. */
export async function readHeroAssets(
  file: URL = heroAssetsFile,
): Promise<Record<string, HeroAsset>> {
  try {
    return heroAssetsSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Records `asset` under the recipe hash, replacing an earlier entry of that hash; the file is swapped in whole. */
export async function recordHeroAsset(
  hash: string,
  asset: HeroAsset,
  file: URL = heroAssetsFile,
): Promise<void> {
  const assets = await readHeroAssets(file);
  const updated = { ...assets, [hash]: heroAssetSchema.parse(asset) };
  const pending = new URL(`${file.href}.tmp`);
  await writeFile(pending, `${JSON.stringify(updated, null, 2)}\n`);
  await rename(pending, file);
}

/** The Blender script that bakes a material recipe; its source is part of every map's hash. */
export const materialRecipeScript = new URL("../style/material-recipe.py", import.meta.url);

export type MaterialMapName = (typeof materialMapNames)[number];

/** The record kind of a material map, beside the hero prop kinds in the same file. */
export function materialMapKind(map: MaterialMapName): string {
  return `material-${map}`;
}

/**
 * The hash of each map of `recipe`: the fields that shape the bake (not `studsPerTile`) and the map name,
 * hashed with the bake script's source, so equal recipes share uploads and a script change bakes anew.
 */
export async function materialMapHashes(
  recipe: MaterialRecipe,
): Promise<Record<MaterialMapName, string>> {
  const source = await readFile(materialRecipeScript, "utf8");
  const { pattern, seed, roughness, metalness } = recipe;
  const entries = materialMapNames.map(
    (map) => [map, recipeHash({ pattern, seed, roughness, metalness, map }, source)] as const,
  );
  return Object.fromEntries(entries) as Record<MaterialMapName, string>;
}

/** The recorded Image asset id of each map of `recipe` that has one, with every map's hash. */
export async function recordedMaterialMaps(
  recipe: MaterialRecipe,
  file: URL = heroAssetsFile,
): Promise<{
  hashes: Record<MaterialMapName, string>;
  recorded: Partial<Record<MaterialMapName, string>>;
}> {
  const hashes = await materialMapHashes(recipe);
  const assets = await readHeroAssets(file);
  const recorded: Partial<Record<MaterialMapName, string>> = {};
  for (const map of materialMapNames) {
    const asset = assets[hashes[map]];
    if (asset?.kind === materialMapKind(map)) recorded[map] = asset.assetId;
  }
  return { hashes, recorded };
}
