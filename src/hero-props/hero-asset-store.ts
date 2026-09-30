import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";

/** The committed record of uploaded hero props, keyed by recipe hash. */
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
