import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.ts";
import { runBlender } from "../src/hero-props/blender-path.ts";
import { generateScriptedMesh } from "../src/hero-props/generate-scripted-mesh.ts";
import { readGlbStructure, type GlbStructure } from "../src/hero-props/glb-structure.ts";
import {
  baseMeshSources,
  currentMeshFiles,
  meshDifferences,
  meshFilesHash,
  sameMeshFiles,
  type ParityResult,
} from "../src/hero-props/mesh-parity.ts";
import { loadPresets } from "../src/style/load-preset.ts";

const defaultBase = "HEAD~1";

async function bakedStructure(script: string): Promise<GlbStructure> {
  const folder = await mkdtemp(join(tmpdir(), "mesh-parity-"));
  try {
    const maps = join(folder, "maps");
    await mkdir(maps);
    await runBlender(script, [join(folder, "out"), maps]);
    const glbs = (await readdir(maps)).filter((name) => name.endsWith(".glb"));
    const [glb, ...others] = glbs;
    if (others.length > 0) {
      throw new Error(`${script} exported ${String(glbs.length)} GLBs into its maps folder`);
    }
    return readGlbStructure(
      await readFile(glb === undefined ? join(folder, "out.glb") : join(maps, glb)),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

interface KindRequest {
  presetName: string;
  kind: string;
  script: string;
  base: string;
}

async function compareKind(
  request: KindRequest,
): Promise<{ result: ParityResult; directory: URL }> {
  const { presetName, kind, script, base } = request;
  const current = await currentMeshFiles(script);
  const before = await baseMeshSources(base, script);
  try {
    const baseHash = meshFilesHash(kind, script, before.files);
    const hash = meshFilesHash(kind, script, current);
    if (sameMeshFiles(before.files, current)) {
      const directory = new URL(
        `../${config.heroPropsFolder}/${presetName}-${kind}-${hash}/`,
        import.meta.url,
      );
      await mkdir(directory, { recursive: true });
      return { result: { hash, baseHash, passed: true, differences: [] }, directory };
    }
    const baseStructure = await bakedStructure(before.script);
    const generated = await generateScriptedMesh(presetName, kind);
    const differences = meshDifferences(baseStructure, generated.structure);
    return {
      result: { hash: generated.hash, baseHash, passed: differences.length === 0, differences },
      directory: generated.directory,
    };
  } finally {
    await rm(before.directory, { recursive: true, force: true });
  }
}

async function reportKind(request: KindRequest): Promise<string[]> {
  const { result, directory } = await compareKind(request);
  await writeFile(new URL("parity.json", directory), `${JSON.stringify(result, null, 2)}\n`);
  const verdict = result.passed ? "parity" : `differs (${result.differences.join("; ")})`;
  console.log(`${request.presetName}/${request.kind}: ${verdict}, ${fileURLToPath(directory)}`);
  return result.passed ? [] : [request.kind];
}

function scriptOf(
  meshes: Record<string, { script: string }>,
  presetName: string,
  kind: string,
): string {
  const script = meshes[kind]?.script;
  if (script === undefined) throw new Error(`Preset "${presetName}" declares no mesh "${kind}"`);
  return script;
}

function parseArguments(args: string[]): { presetName?: string; base: string; kinds: string[] } {
  const [presetName, ...rest] = args;
  const flag = rest.indexOf("--base");
  if (flag < 0) return { presetName, base: defaultBase, kinds: rest };
  const kinds = rest.filter((_, index) => index !== flag && index !== flag + 1);
  return { presetName, base: rest[flag + 1] ?? "", kinds };
}

const { presetName, base, kinds } = parseArguments(process.argv.slice(2));
if (presetName === undefined || base === "") {
  console.error("Usage: node scripts/mesh-parity.ts <preset> [--base <git ref>] [<kind>...]");
  process.exit(1);
}

const differing: string[] = [];
try {
  const meshes = (await loadPresets()).get(presetName)?.meshes ?? {};
  const selected = kinds.length > 0 ? kinds : Object.keys(meshes);
  if (selected.length === 0) throw new Error(`Preset "${presetName}" declares no meshes`);
  for (const kind of selected) {
    const script = scriptOf(meshes, presetName, kind);
    differing.push(...(await reportKind({ presetName, kind, script, base })));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
if (differing.length > 0) {
  console.error(`Differing kinds: ${differing.join(", ")}`);
  process.exit(1);
}
