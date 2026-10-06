import { parseArgs } from "node:util";
import { heroPropAsset } from "../src/hero-props/hero-prop-asset.ts";
import { propRecipeKindsOf, trimRecipes } from "../src/hero-props/prop-recipes.ts";
import { loadPresets } from "../src/style/load-preset.ts";

/**
 * `node scripts/upload-hero-props.ts <preset> [--kinds <a,b>] [--dry-run]` uploads every hero prop of the preset,
 * every declared Blender mesh, every `prop-<kind>` mesh of its prop kit and every `trim-<profile>` mesh, whose
 * checks passed and whose recipe hash has no recorded asset, through the same `heroPropAsset` that build_map uses,
 * and prints `kind -> asset id` per kind. `--kinds` limits the run to the named kinds; `--dry-run` asks for no
 * credentials and uploads nothing, printing "would upload" for each kind that an upload would send. It exits 1
 * when the key or creator is missing or an upload fails, or when `--kinds` names a kind the preset lacks.
 */
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { kinds: { type: "string" }, "dry-run": { type: "boolean" } },
  args: process.argv.slice(2),
});
const [presetName, ...extra] = positionals;
if (presetName === undefined || extra.length > 0) {
  console.error("Usage: node scripts/upload-hero-props.ts <preset> [--kinds <a,b>] [--dry-run]");
  process.exit(1);
}
const dryRun = values["dry-run"] === true;

try {
  const preset = (await loadPresets()).get(presetName);
  if (preset === undefined) throw new Error(`No preset named "${presetName}"`);
  // A declared mesh wins over a recipe of the same kind, so a kind named twice is one upload.
  const available = new Set([
    ...Object.keys(preset.heroProps ?? {}),
    ...Object.keys(preset.meshes ?? {}),
    ...propRecipeKindsOf(preset),
    ...Object.keys(trimRecipes),
  ]);
  const wanted = values.kinds?.split(",").map((kind) => kind.trim());
  const unknown = wanted?.filter((kind) => !available.has(kind)) ?? [];
  if (unknown.length > 0) {
    throw new Error(`Preset "${presetName}" has no kind ${unknown.join(", ")}`);
  }
  for (const kind of wanted ?? available) {
    const asset = await heroPropAsset(
      presetName,
      preset,
      kind,
      dryRun ? { credentials: () => Promise.resolve({ missing: "dry run" }) } : {},
    );
    switch (asset.status) {
      case "recorded":
        console.log(`${kind} -> ${asset.assetId} (already recorded)`);
        break;
      case "uploaded":
        console.log(`${kind} -> ${asset.assetId}`);
        break;
      case "unreviewed":
        console.log(`${kind}: recipe ${asset.hash} has no passed checks; not uploaded`);
        break;
      case "no-credentials":
        if (dryRun) {
          console.log(`${kind}: would upload recipe ${asset.hash}`);
          break;
        }
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
