import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import type { GlbStructure } from "./glb-structure.ts";
import { heroAssetsFile, readHeroAssets, rekeyHeroAsset } from "./hero-asset-store.ts";
import { recipeHash } from "./recipe-hash.ts";

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../../", import.meta.url);
const meshesFolder = "src/hero-props/meshes";
const boundsTolerance = 0.01;
const gitBufferBytes = 10 * 1024 * 1024;
const axes = ["x", "y", "z"] as const;

export type GitRunner = (args: string[]) => Promise<string>;

export type MeshFiles = Record<string, string>;

export interface BaseMeshSources {
  directory: string;
  script: string;
  files: MeshFiles;
}

export const parityResultSchema = z.object({
  hash: z.string(),
  baseHash: z.string(),
  passed: z.boolean(),
  differences: z.array(z.string()),
});

export type ParityResult = z.output<typeof parityResultSchema>;

async function runGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: fileURLToPath(repositoryRoot),
    maxBuffer: gitBufferBytes,
  });
  return stdout;
}

function isLibraryFile(name: string): boolean {
  return name === "shared.py" || (name.startsWith("lib/") && name.endsWith(".py"));
}

export async function baseMeshSources(
  ref: string,
  script: string,
  git: GitRunner = runGit,
): Promise<BaseMeshSources> {
  const listing = await git(["ls-tree", "-r", "--name-only", ref, "--", meshesFolder]);
  const library = listing
    .split("\n")
    .filter((path) => isLibraryFile(path.slice(meshesFolder.length + 1)));
  const files: MeshFiles = {};
  for (const path of [script, ...library]) files[path] = await git(["show", `${ref}:${path}`]);
  const directory = await mkdtemp(join(tmpdir(), "mesh-base-"));
  for (const [path, source] of Object.entries(files)) {
    await mkdir(join(directory, dirname(path)), { recursive: true });
    await writeFile(join(directory, path), source);
  }
  return { directory, script: join(directory, script), files };
}

async function libraryPaths(root: URL): Promise<string[]> {
  const names = ["shared.py"];
  try {
    const entries = await readdir(new URL(`${meshesFolder}/lib/`, root));
    names.push(...entries.filter((name) => name.endsWith(".py")).map((name) => `lib/${name}`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return names.map((name) => `${meshesFolder}/${name}`);
}

export async function currentMeshFiles(
  script: string,
  root: URL = repositoryRoot,
): Promise<MeshFiles> {
  const files: MeshFiles = {};
  for (const path of [script, ...(await libraryPaths(root))]) {
    files[path] = await readFile(new URL(path, root), "utf8");
  }
  return files;
}

export function sameMeshFiles(base: MeshFiles, current: MeshFiles): boolean {
  const paths = Object.keys(base);
  return (
    paths.length === Object.keys(current).length &&
    paths.every((path) => base[path] === current[path])
  );
}

export function meshFilesHash(kind: string, script: string, files: MeshFiles): string {
  const shared = files[`${meshesFolder}/shared.py`] ?? "";
  return recipeHash({ kind, script }, `${files[script] ?? ""}\0${shared}`);
}

function listed(values: unknown): string {
  return JSON.stringify(values);
}

export function meshDifferences(base: GlbStructure, current: GlbStructure): string[] {
  const found: string[] = [];
  if (base.triangles !== current.triangles) {
    found.push(`triangles ${String(base.triangles)} vs ${String(current.triangles)}`);
  }
  axes.forEach((axis, index) => {
    const before = base.size[index] ?? 0;
    const after = current.size[index] ?? 0;
    if (Math.abs(before - after) > boundsTolerance) {
      found.push(`${axis} bound ${before.toFixed(3)} vs ${after.toFixed(3)}`);
    }
  });
  const rows = [
    ["material names", base.materialNames, current.materialNames],
    ["material maps", base.materialMaps, current.materialMaps],
    ["image hashes", base.imageHashes ?? [], current.imageHashes ?? []],
  ] as const;
  for (const [label, before, after] of rows) {
    if (listed(before) === listed(after)) continue;
    found.push(`${label} ${listed(before)} vs ${listed(after)}`);
  }
  return found;
}

export async function rekeyMesh(
  parity: unknown,
  file: URL = heroAssetsFile,
): Promise<"moved" | "unchanged"> {
  const result = parityResultSchema.parse(parity);
  if (!result.passed) {
    throw new Error(`Mesh ${result.hash} did not pass parity: ${result.differences.join("; ")}`);
  }
  if (result.baseHash === result.hash) return "unchanged";
  const assets = await readHeroAssets(file);
  if (assets[result.baseHash] === undefined && assets[result.hash] !== undefined) {
    return "unchanged";
  }
  await rekeyHeroAsset(result.baseHash, result.hash, file);
  return "moved";
}
