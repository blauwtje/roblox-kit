import { readFile } from "node:fs/promises";
import { config } from "../src/config.ts";
import { scriptedMeshHash } from "../src/hero-props/generate-scripted-mesh.ts";
import { recordHeroAsset } from "../src/hero-props/hero-asset-store.ts";
import { parityResultSchema, rekeyMesh, type ParityResult } from "../src/hero-props/mesh-parity.ts";
import { loadPresets } from "../src/style/load-preset.ts";

const [presetName, kind, assetId, ...extra] = process.argv.slice(2);
if (
  presetName === undefined ||
  kind === undefined ||
  (assetId !== undefined && !/^\d+$/.test(assetId)) ||
  extra.length > 0
) {
  console.error("Usage: node scripts/record-mesh-asset.ts <preset> <kind> [assetId]");
  process.exit(1);
}

async function readParity(label: string, hash: string): Promise<ParityResult> {
  const file = new URL(
    `../${config.heroPropsFolder}/${label}-${hash}/parity.json`,
    import.meta.url,
  );
  try {
    return parityResultSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(`${label} (${hash}) has no parity.json; run scripts/mesh-parity.ts first`, {
      cause: error,
    });
  }
}

try {
  const declaration = (await loadPresets()).get(presetName)?.meshes?.[kind];
  if (declaration === undefined)
    throw new Error(`Preset "${presetName}" declares no mesh "${kind}"`);
  const hash = await scriptedMeshHash(kind, declaration);
  const result = await readParity(`${presetName}-${kind}`, hash);
  if (result.hash !== hash || !result.passed) {
    throw new Error(
      `${presetName}/${kind} (${hash}) did not pass parity: ${result.differences.join("; ") || `result is for ${result.hash}`}`,
    );
  }
  if (assetId === undefined) {
    console.log(`${presetName}/${kind}: ${await rekeyMesh(result)} ${result.baseHash} -> ${hash}`);
  } else {
    await recordHeroAsset(hash, { kind, assetId });
    console.log(`${presetName}/${kind}: recorded ${assetId} for ${hash}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
