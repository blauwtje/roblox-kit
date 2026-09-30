import { fileURLToPath } from "node:url";
import { generateHeroProp } from "../src/hero-props/generate-hero-prop.ts";

/**
 * `node scripts/hero-props.ts <preset> <kind>` generates the preset's hero prop of that kind with headless
 * Blender into `.roblox-kit/hero-props/<preset>-<kind>-<hash>/model.glb` and prints its triangles and size;
 * it exits 1 when the GLB exceeds its triangle budget, lacks a role or is off the recipe size.
 */
const [presetName, kind, ...extra] = process.argv.slice(2);
if (presetName === undefined || kind === undefined || extra.length > 0) {
  console.error("Usage: node scripts/hero-props.ts <preset> <kind>");
  process.exit(1);
}

try {
  const generated = await generateHeroProp(presetName, kind);
  const [width, height, depth] = generated.structure.size;
  console.log(
    `${presetName}/${kind}: ${String(generated.structure.triangles)} triangles, ` +
      `${width.toFixed(2)} x ${height.toFixed(2)} x ${depth.toFixed(2)} studs, ${fileURLToPath(generated.glb)}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
