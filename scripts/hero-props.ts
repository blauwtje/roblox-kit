import { fileURLToPath } from "node:url";
import { generateHeroProp } from "../src/hero-props/generate-hero-prop.ts";
import { renderHeroProp } from "../src/hero-props/render-hero-prop.ts";
import { writeHeroPropChecks } from "../src/hero-props/open-cloud-upload.ts";

/**
 * `node scripts/hero-props.ts <preset> <kind>` generates the preset's hero prop of that kind with headless
 * Blender into `.roblox-kit/hero-props/<preset>-<kind>-<hash>/model.glb` and prints its triangles and size,
 * then renders `front.png`, `side.png` and `three-quarter.png` beside it and writes the GLB's deterministic
 * checks (floating parts, inverted normals) into the checks file the upload reads; it exits 1 when the GLB
 * exceeds its triangle budget, lacks a role or is off the recipe size, when a render is missing, or when
 * the checks do not pass.
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
  const renders = await renderHeroProp(generated.glb);
  for (const render of renders) console.log(fileURLToPath(render));
  const checks = await writeHeroPropChecks(generated.directory, generated.hash);
  console.log(`${String(checks.parts)} parts`);
  if (!checks.passed) {
    console.error(
      `Checks of ${presetName}/${kind} (${checks.hash}) did not pass: ` +
        `floating ${checks.floatingParts.join(", ") || "none"}; ` +
        `inverted ${checks.invertedParts.join(", ") || "none"}.`,
    );
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
