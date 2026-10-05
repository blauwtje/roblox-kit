import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "../src/config.ts";
import { blenderPath } from "../src/hero-props/blender-path.ts";
import {
  materialRecipeScript,
  recordedMaterialMaps,
  type MaterialMapName,
} from "../src/hero-props/hero-asset-store.ts";
import { lookUpOpenCloudCredentials } from "../src/hero-props/open-cloud-credentials.ts";
import { uploadMaterialMaps } from "../src/hero-props/open-cloud-upload.ts";
import { loadPresets } from "../src/style/load-preset.ts";
import { materialMapNames, type MaterialRecipe } from "../src/style/preset-schema.ts";

/**
 * `npm run materials -- <preset> [--bake-only]` gives every surface role of the preset with a `texture` recipe
 * its four PBR maps. A map whose recipe hash is recorded in `hero-assets.json` is reused; otherwise the recipe
 * is baked headless in Blender to `.roblox-kit/materials/<preset>-<role>/`, the missing PNGs are uploaded as
 * Images and recorded by hash, and the role's `variant` (base material, studs per tile, the four ContentIds) is
 * written into `presets/<preset>.json`. `--bake-only` bakes every recipe and stops before credentials and
 * uploads. It exits 1 on a missing key or creator or a failed bake or upload.
 */
const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../", import.meta.url);
const materialsFolder = new URL(".roblox-kit/materials/", repositoryRoot);
/** Blender prints its whole log on stdout; the buffer only has to hold it. */
const blenderOutputBytes = 10 * 1024 * 1024;

const [presetName, ...flags] = process.argv.slice(2);
const bakeOnly = flags.includes("--bake-only");
if (presetName === undefined || flags.some((flag) => flag !== "--bake-only")) {
  console.error("Usage: npm run materials -- <preset> [--bake-only]");
  process.exit(1);
}

/** Bakes `recipe` into `directory` as color.png, normal.png, roughness.png and metalness.png. */
async function bake(recipe: MaterialRecipe, directory: URL): Promise<void> {
  await mkdir(directory, { recursive: true });
  const recipeFile = new URL("recipe.json", directory);
  await writeFile(recipeFile, JSON.stringify(recipe, null, 2));
  await execFileAsync(
    blenderPath(process.env),
    [
      "-b",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "-P",
      fileURLToPath(materialRecipeScript),
      "--",
      fileURLToPath(recipeFile),
      fileURLToPath(directory),
    ],
    { timeout: config.blenderTimeoutMs, maxBuffer: blenderOutputBytes },
  );
}

/**
 * `text` with the surface role's `variant` set to `variant`, replacing an earlier one. The edit is line-based
 * on the Prettier layout of a preset (a role at 4 spaces, its fields at 6), so the rest of the file keeps its
 * formatting; a layout it does not find throws.
 */
function withVariant(text: string, role: string, variant: unknown): string {
  const lines = text.split("\n");
  const surfaces = lines.indexOf('  "surfaces": {');
  const start = surfaces < 0 ? -1 : lines.indexOf(`    "${role}": {`, surfaces);
  if (start < 0) throw new Error(`No "${role}" surface block in the preset file.`);
  let end = start + 1;
  while (end < lines.length && !(lines[end] ?? "").startsWith("    }")) end++;
  const fields: string[][] = [];
  for (const line of lines.slice(start + 1, end)) {
    if (/^ {6}"/.test(line)) fields.push([line]);
    else fields.at(-1)?.push(line);
  }
  const kept = fields.filter(([first]) => !first?.startsWith('      "variant":')).flat();
  const [head = "", ...rest] = JSON.stringify(variant, null, 2).split("\n");
  const body = [
    ...kept.map((line, index) => (index === kept.length - 1 ? line.replace(/,?$/, ",") : line)),
    `      "variant": ${head}`,
    ...rest.map((line) => `      ${line}`),
  ];
  return [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join("\n");
}

/** The `variant` written into the preset for a role whose four maps are uploaded. */
function variantOf(
  material: string,
  recipe: MaterialRecipe,
  assetIds: Record<MaterialMapName, string>,
): unknown {
  const maps = Object.fromEntries(
    materialMapNames.map((map) => [map, `rbxassetid://${assetIds[map]}`]),
  );
  return { baseMaterial: material, studsPerTile: recipe.studsPerTile, maps };
}

try {
  const preset = (await loadPresets()).get(presetName);
  if (preset === undefined) throw new Error(`No preset named "${presetName}"`);
  const presetFile = new URL(`presets/${presetName}.json`, repositoryRoot);
  const original = await readFile(presetFile, "utf8");
  let text = original;
  for (const [role, surface] of Object.entries(preset.surfaces)) {
    const recipe = surface.texture;
    if (recipe === undefined) continue;
    const { hashes, recorded } = await recordedMaterialMaps(recipe);
    const missing = materialMapNames.filter((map) => recorded[map] === undefined);
    let assetIds: Record<MaterialMapName, string>;
    if (missing.length === 0 && !bakeOnly) {
      assetIds = recorded as Record<MaterialMapName, string>;
      console.log(`${role}: all four maps already recorded`);
    } else {
      const directory = new URL(`${presetName}-${role}/`, materialsFolder);
      await bake(recipe, directory);
      console.log(`${role}: baked ${recipe.pattern} to ${fileURLToPath(directory)}`);
      if (bakeOnly) continue;
      const lookup = await lookUpOpenCloudCredentials();
      if ("missing" in lookup) throw new Error(`Not uploaded: ${lookup.missing}`);
      assetIds = await uploadMaterialMaps(
        `${presetName}-${role}`,
        hashes,
        directory,
        lookup.credentials,
      );
      console.log(`${role}: uploaded ${missing.join(", ")}`);
    }
    if (
      JSON.stringify(surface.variant) !==
      JSON.stringify(variantOf(surface.material, recipe, assetIds))
    ) {
      text = withVariant(text, role, variantOf(surface.material, recipe, assetIds));
    }
    console.log(
      `${role} -> ${materialMapNames.map((map) => `${map} ${assetIds[map]}`).join(", ")}`,
    );
  }
  if (text !== original) {
    await writeFile(presetFile, text);
    await execFileAsync("npx", ["prettier", "--write", fileURLToPath(presetFile)], {
      cwd: fileURLToPath(repositoryRoot),
    });
    console.log(`Wrote the variants into ${fileURLToPath(presetFile)}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
