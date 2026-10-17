import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import type { GlbStructure } from "./glb-structure.ts";
import { config } from "../config.ts";
import { decodePng } from "./png-pixels.ts";
import { heroAssetsFile, readHeroAssets, rekeyHeroAsset } from "./hero-asset-store.ts";
import { scriptedMeshHash, type MeshSourceReader } from "./generate-scripted-mesh.ts";
import { loadPresets } from "../style/load-preset.ts";

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

async function isLibraryFile(name: string): Promise<boolean> {
  if (!name.endsWith(".py")) return false;
  const presetNames = new Set((await loadPresets()).keys());
  return !presetNames.has(name.split("/")[0] ?? "");
}

export async function baseMeshSources(
  ref: string,
  script: string,
  git: GitRunner = runGit,
): Promise<BaseMeshSources> {
  const listing = await git(["ls-tree", "-r", "--name-only", ref, "--", meshesFolder]);
  const library: string[] = [];
  for (const path of listing.split("\n")) {
    if (await isLibraryFile(path.slice(meshesFolder.length + 1))) library.push(path);
  }
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
  const entries = await readdir(new URL(`${meshesFolder}/`, root), { recursive: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (await isLibraryFile(entry.replaceAll("\\", "/"))) names.push(entry);
  }
  return names.sort().map((name) => `${meshesFolder}/${name}`);
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

export async function meshFilesHash(
  kind: string,
  script: string,
  files: MeshFiles,
): Promise<string> {
  const prefix = `${meshesFolder}/`;
  const reader: MeshSourceReader = {
    list: () => Promise.resolve(Object.keys(files).map((path) => path.replace(prefix, ""))),
    read: (path) => Promise.resolve(files[`${prefix}${path}`] ?? ""),
  };
  return await scriptedMeshHash(kind, { script, targets: [] }, reader);
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
  ] as const;
  for (const [label, before, after] of rows) {
    if (listed(before) === listed(after)) continue;
    found.push(`${label} ${listed(before)} vs ${listed(after)}`);
  }
  found.push(...imageDifferences(base.imageBytes ?? [], current.imageBytes ?? []));
  return found;
}

/** The largest per-channel mean absolute difference (0 to 255) between two same-size images. */
export function imageNoise(base: Uint8Array, current: Uint8Array): number {
  const before = decodePng(base);
  const after = decodePng(current);
  const sums = new Array<number>(before.channels).fill(0);
  before.data.forEach((value, index) => {
    const channel = index % before.channels;
    sums[channel] = (sums[channel] ?? 0) + Math.abs(value - (after.data[index] ?? 0));
  });
  return Math.max(...sums) / (before.width * before.height);
}

function imageDifferences(base: Uint8Array[], current: Uint8Array[]): string[] {
  if (base.length !== current.length) {
    return [`image count ${String(base.length)} vs ${String(current.length)}`];
  }
  const found: string[] = [];
  base.forEach((bytes, index) => {
    const other = current[index] ?? new Uint8Array();
    const before = decodePng(bytes);
    const after = decodePng(other);
    const label = `image ${String(index)}`;
    if (
      before.width !== after.width ||
      before.height !== after.height ||
      before.channels !== after.channels
    ) {
      found.push(
        `${label} size ${String(before.width)}x${String(before.height)}x${String(before.channels)} vs ${String(after.width)}x${String(after.height)}x${String(after.channels)}`,
      );
      return;
    }
    const noise = imageNoise(bytes, other);
    if (noise > config.heroPropImageTolerance) {
      found.push(
        `${label} pixels differ by ${noise.toFixed(2)} per channel (tolerance ${String(config.heroPropImageTolerance)})`,
      );
    }
  });
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
