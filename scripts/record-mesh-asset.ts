import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../src/config.ts";
import { scriptedMeshHash } from "../src/hero-props/generate-scripted-mesh.ts";
import { recordHeroAsset } from "../src/hero-props/hero-asset-store.ts";
import { loadPresets } from "../src/style/load-preset.ts";

/**
 * `node scripts/record-mesh-asset.ts <preset> <kind> <assetId>` records an existing Model id against the
 * declared mesh's current recipe hash in `hero-assets.json`, only when `scripts/mesh-parity.ts` left a passed
 * `parity.json` for that hash in the kind's generated folder. It exits 1 on a missing or failed parity, a stale
 * hash or a malformed id, and records nothing.
 */
const parity = z.object({
  hash: z.string(),
  passed: z.boolean(),
  differences: z.array(z.string()),
});

const [presetName, kind, assetId, ...extra] = process.argv.slice(2);
if (
  presetName === undefined ||
  kind === undefined ||
  assetId === undefined ||
  !/^\d+$/.test(assetId) ||
  extra.length > 0
) {
  console.error("Usage: node scripts/record-mesh-asset.ts <preset> <kind> <assetId>");
  process.exit(1);
}

try {
  const declaration = (await loadPresets()).get(presetName)?.meshes?.[kind];
  if (declaration === undefined)
    throw new Error(`Preset "${presetName}" declares no mesh "${kind}"`);
  const hash = await scriptedMeshHash(kind, declaration);
  const file = new URL(
    `../${config.heroPropsFolder}/${presetName}-${kind}-${hash}/parity.json`,
    import.meta.url,
  );
  let result: z.output<typeof parity>;
  try {
    result = parity.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(
      `${presetName}/${kind} (${hash}) has no parity.json; run scripts/mesh-parity.ts first`,
      { cause: error },
    );
  }
  if (result.hash !== hash || !result.passed) {
    throw new Error(
      `${presetName}/${kind} (${hash}) did not pass parity: ${result.differences.join("; ") || `result is for ${result.hash}`}`,
    );
  }
  await recordHeroAsset(hash, { kind, assetId });
  console.log(`${presetName}/${kind}: recorded ${assetId} for ${hash}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
