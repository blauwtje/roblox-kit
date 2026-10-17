import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "../config.ts";
import { loadPresets } from "../style/load-preset.ts";
import { heroParts, type Preset } from "../style/preset-schema.ts";
import { readGlbStructure, type GlbStructure } from "./glb-structure.ts";
import { runBlender } from "./blender-path.ts";
import { heroRecipeOf } from "./prop-recipes.ts";
import { recipeHash } from "./recipe-hash.ts";

const repositoryRoot = new URL("../../", import.meta.url);
const generatorScript = new URL("./generate-hero-prop.py", import.meta.url);
const recipeFileName = "recipe.json";
const glbFileName = "model.glb";

type HeroPropRecipe = NonNullable<Preset["heroProps"]>[string];

export interface GeneratedHeroProp {
  hash: string;
  directory: URL;
  glb: URL;
  structure: GlbStructure;
}

/** The maps every role's material must read: the baked color, normal, and packed roughness and metalness. */
export const requiredMaps = ["color", "normal", "roughness-metalness"];

/** Problems of a generated GLB against its recipe: over budget, a role missing or without its texture maps, or off size. */
function structureProblems(recipe: HeroPropRecipe, structure: GlbStructure): string[] {
  const problems: string[] = [];
  if (structure.triangles > recipe.triangleBudget) {
    problems.push(
      `${String(structure.triangles)} triangles exceed the budget of ${String(recipe.triangleBudget)}`,
    );
  }
  for (const role of new Set(heroParts(recipe.operations).map((part) => part.shape.role))) {
    if (!structure.meshNames.includes(role)) problems.push(`no mesh named "${role}"`);
    const materialIndex = structure.materialNames.indexOf(role);
    if (materialIndex === -1) {
      problems.push(`no material named "${role}"`);
      continue;
    }
    const maps = structure.materialMaps[materialIndex] ?? [];
    for (const map of requiredMaps) {
      if (!maps.includes(map)) problems.push(`material "${role}" has no ${map} map`);
    }
  }
  const { width, height, depth } = recipe.size;
  const axes = [
    ["width", width],
    ["height", height],
    ["depth", depth],
  ] as const;
  axes.forEach(([axis, expected], index) => {
    const actual = structure.size[index] ?? Number.NaN;
    if (!(Math.abs(actual - expected) <= config.heroPropSizeToleranceStuds)) {
      problems.push(
        `${axis} is ${actual.toFixed(3)} studs, not the recipe's ${String(expected)} within ${String(config.heroPropSizeToleranceStuds)}`,
      );
    }
  });
  return problems;
}

/** Generates the preset's hero prop of `kind` with headless Blender into `.roblox-kit/hero-props/<preset>-<kind>-<hash>/model.glb`, throwing when its structure fails the recipe. */
export async function generateHeroProp(
  presetName: string,
  kind: string,
): Promise<GeneratedHeroProp> {
  const preset = (await loadPresets()).get(presetName);
  if (preset === undefined) throw new Error(`No preset named "${presetName}"`);
  const recipe = heroRecipeOf(preset, kind);
  if (recipe === undefined) throw new Error(`Preset "${presetName}" has no hero prop "${kind}"`);

  const roleColors: Record<string, string> = {};
  for (const part of heroParts(recipe.operations)) {
    roleColors[part.shape.role] = preset.surfaces[part.shape.role].color;
  }
  const generatorSource = await readFile(generatorScript, "utf8");
  const hash = recipeHash({ recipe, roleColors }, generatorSource);
  const directory = new URL(
    `${config.heroPropsFolder}/${presetName}-${kind}-${hash}/`,
    repositoryRoot,
  );
  const glb = new URL(glbFileName, directory);
  await mkdir(directory, { recursive: true });
  const recipeFile = new URL(recipeFileName, directory);
  await writeFile(
    recipeFile,
    JSON.stringify({ operations: recipe.operations, roles: roleColors }, null, 2),
  );

  await runBlender(fileURLToPath(generatorScript), [fileURLToPath(recipeFile), fileURLToPath(glb)]);

  const structure = readGlbStructure(await readFile(glb));
  const problems = structureProblems(recipe, structure);
  if (problems.length > 0) {
    throw new Error(`Hero prop ${presetName}/${kind} fails its recipe: ${problems.join("; ")}`);
  }
  return { hash, directory, glb, structure };
}
