import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "../config.ts";
import { loadPresets } from "../style/load-preset.ts";
import type { MeshDeclaration } from "../style/preset-schema.ts";
import { blenderPath } from "./blender-path.ts";
import { readGlbStructure, type GlbStructure } from "./glb-structure.ts";
import { blenderOutputBytes, requiredMaps, type GeneratedHeroProp } from "./generate-hero-prop.ts";
import { recipeHash } from "./recipe-hash.ts";

const execFileAsync = promisify(execFile);

const repositoryRoot = new URL("../../", import.meta.url);
const sharedScript = new URL("./meshes/shared.py", import.meta.url);
/** Most triangles a scripted mesh may hold; the same limit the recipe-built hero props keep. */
const maxScriptedMeshTriangles = 20000;

/** The recipe hash of a declared mesh: its script path hashed with the script's source and `shared.py`'s, so a change to either names a new output. */
export async function scriptedMeshHash(
  kind: string,
  declaration: MeshDeclaration,
): Promise<string> {
  const script = await readFile(new URL(declaration.script, repositoryRoot), "utf8");
  const shared = await readFile(sharedScript, "utf8");
  return recipeHash({ kind, script: declaration.script }, `${script}\0${shared}`);
}

/** Problems of a generated GLB: no mesh, over the triangle limit, or a material without its texture maps. */
export function scriptedMeshProblems(structure: GlbStructure): string[] {
  const problems: string[] = [];
  if (structure.meshNames.length === 0) problems.push("it holds no mesh");
  if (structure.triangles > maxScriptedMeshTriangles) {
    problems.push(
      `${String(structure.triangles)} triangles exceed the limit of ${String(maxScriptedMeshTriangles)}`,
    );
  }
  structure.materialNames.forEach((name, index) => {
    const maps = structure.materialMaps[index] ?? [];
    for (const map of requiredMaps) {
      if (!maps.includes(map)) problems.push(`material "${name}" has no ${map} map`);
    }
  });
  return problems;
}

/** Generates the preset's declared mesh of `kind` with headless Blender into `.roblox-kit/hero-props/<preset>-<kind>-<hash>/model.glb`, throwing when its structure fails. */
export async function generateScriptedMesh(
  presetName: string,
  kind: string,
): Promise<GeneratedHeroProp> {
  const preset = (await loadPresets()).get(presetName);
  if (preset === undefined) throw new Error(`No preset named "${presetName}"`);
  const declaration = preset.meshes?.[kind];
  if (declaration === undefined) {
    throw new Error(`Preset "${presetName}" declares no mesh "${kind}"`);
  }
  const hash = await scriptedMeshHash(kind, declaration);
  const directory = new URL(
    `${config.heroPropsFolder}/${presetName}-${kind}-${hash}/`,
    repositoryRoot,
  );
  const maps = new URL("maps/", directory);
  await mkdir(maps, { recursive: true });
  await execFileAsync(
    blenderPath(process.env),
    [
      "-b",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "-P",
      fileURLToPath(new URL(declaration.script, repositoryRoot)),
      "--",
      fileURLToPath(new URL(kind, directory)),
      fileURLToPath(maps),
    ],
    { timeout: config.blenderTimeoutMs, maxBuffer: blenderOutputBytes },
  );
  const glb = new URL("model.glb", directory);
  await copyFile(new URL(`${kind}.glb`, maps), glb);
  const structure = readGlbStructure(await readFile(glb));
  const problems = scriptedMeshProblems(structure);
  if (problems.length > 0) {
    throw new Error(`Mesh ${presetName}/${kind} fails its checks: ${problems.join("; ")}`);
  }
  return { hash, directory, glb, structure };
}
