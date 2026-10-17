import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "../config.ts";
import { loadPresets } from "../style/load-preset.ts";
import type { MeshDeclaration } from "../style/preset-schema.ts";
import { runBlender } from "./blender-path.ts";
import { readGlbStructure, type GlbStructure } from "./glb-structure.ts";
import { requiredMaps, type GeneratedHeroProp } from "./generate-hero-prop.ts";
import { recipeHash } from "./recipe-hash.ts";

const repositoryRoot = new URL("../../", import.meta.url);
/** Most triangles a scripted mesh may hold; the same limit the recipe-built hero props keep. */
const maxScriptedMeshTriangles = 20000;

const meshesPrefix = "src/hero-props/meshes/";
const meshesFolder = new URL("./meshes/", import.meta.url);

/** Reads the mesh library: `list` gives `.py` paths relative to the meshes folder, `read` one file's source. */
export interface MeshSourceReader {
  list: () => Promise<string[]>;
  read: (path: string) => Promise<string>;
}

const fileReader: MeshSourceReader = {
  list: async () =>
    (await readdir(meshesFolder, { recursive: true })).filter((path) => path.endsWith(".py")),
  read: (path) => readFile(new URL(path, meshesFolder), "utf8"),
};

/** The recipe hash of a declared mesh: its script path hashed with the script's source and every library `.py` under `meshes/` outside preset folders (sorted by path), so a change to any of them names a new output. */
export async function scriptedMeshHash(
  kind: string,
  declaration: MeshDeclaration,
  reader: MeshSourceReader = fileReader,
): Promise<string> {
  const presetNames = new Set((await loadPresets()).keys());
  const library = (await reader.list())
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => !presetNames.has(path.split("/")[0] ?? ""))
    .sort();
  const script = await reader.read(declaration.script.replace(meshesPrefix, ""));
  const sources: string[] = [script];
  for (const path of library) sources.push(`${path}\0${await reader.read(path)}`);
  return recipeHash({ kind, script: declaration.script }, sources.join("\0"));
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
  await runBlender(fileURLToPath(new URL(declaration.script, repositoryRoot)), [
    fileURLToPath(new URL(kind, directory)),
    fileURLToPath(maps),
  ]);
  const glb = new URL("model.glb", directory);
  await copyFile(new URL(`${kind}.glb`, maps), glb);
  const structure = readGlbStructure(await readFile(glb));
  const problems = scriptedMeshProblems(structure);
  if (problems.length > 0) {
    throw new Error(`Mesh ${presetName}/${kind} fails its checks: ${problems.join("; ")}`);
  }
  return { hash, directory, glb, structure };
}
