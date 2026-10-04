import { heroPropAsset } from "../src/hero-props/hero-prop-asset.ts";
import { loadPresets } from "../src/style/load-preset.ts";

/**
 * `node scripts/upload-hero-props.ts <preset>` uploads every hero prop of the preset whose review passed and
 * whose recipe hash has no recorded asset, through the same `heroPropAsset` that build_map uses, and prints
 * `kind -> asset id` per hero prop. It exits 1 when the key or creator is missing or an upload fails.
 */
const [presetName, ...extra] = process.argv.slice(2);
if (presetName === undefined || extra.length > 0) {
  console.error("Usage: node scripts/upload-hero-props.ts <preset>");
  process.exit(1);
}

try {
  const preset = (await loadPresets()).get(presetName);
  if (preset === undefined) throw new Error(`No preset named "${presetName}"`);
  for (const kind of Object.keys(preset.heroProps ?? {})) {
    const asset = await heroPropAsset(presetName, preset, kind);
    switch (asset.status) {
      case "recorded":
        console.log(`${kind} -> ${asset.assetId} (already recorded)`);
        break;
      case "uploaded":
        console.log(`${kind} -> ${asset.assetId}`);
        break;
      case "unreviewed":
        console.log(`${kind}: recipe ${asset.hash} has no passed review; not uploaded`);
        break;
      case "no-credentials":
        console.error(`${kind}: not uploaded: ${asset.missing}`);
        process.exitCode = 1;
        break;
      case "upload-failed":
        console.error(`${kind}: upload of recipe ${asset.hash} failed: ${asset.error}`);
        process.exitCode = 1;
        break;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
