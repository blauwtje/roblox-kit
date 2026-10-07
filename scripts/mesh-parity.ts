import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "../src/config.ts";
import { blenderPath } from "../src/hero-props/blender-path.ts";
import { blenderOutputBytes } from "../src/hero-props/generate-hero-prop.ts";
import { generateScriptedMesh } from "../src/hero-props/generate-scripted-mesh.ts";
import { readGlbStructure, type GlbStructure } from "../src/hero-props/glb-structure.ts";

/**
 * `node scripts/mesh-parity.ts <preset> <kind>=<original.py>...` runs each original script and the preset's
 * repository script of that kind with headless Blender, compares their triangle counts and bounds (to 0.01
 * stud) and writes `parity.json` with the result into the kind's generated folder, where
 * `record-mesh-asset.ts` reads it. It prints each kind and exits 1 when any kind differs.
 */
const execFileAsync = promisify(execFile);
/** How far apart two bounds may be, in studs, and still count as the same size. */
const boundsTolerance = 0.01;

/** Runs the original script into a temp folder and reads the one GLB it exports, from the maps folder or `<out prefix>.glb`. */
async function originalStructure(script: string): Promise<GlbStructure> {
  const folder = await mkdtemp(join(tmpdir(), "mesh-parity-"));
  try {
    const maps = join(folder, "maps");
    await mkdir(maps);
    await execFileAsync(
      blenderPath(process.env),
      [
        "-b",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "-P",
        script,
        "--",
        join(folder, "out"),
        maps,
      ],
      { timeout: config.blenderTimeoutMs, maxBuffer: blenderOutputBytes },
    );
    const glbs = (await readdir(maps)).filter((name) => name.endsWith(".glb"));
    const [glb, ...others] = glbs;
    if (others.length > 0) {
      throw new Error(`${script} exported ${String(glbs.length)} GLBs into its maps folder`);
    }
    // A script may write its one GLB beside the out prefix instead of into the maps folder.
    return readGlbStructure(
      await readFile(glb === undefined ? join(folder, "out.glb") : join(maps, glb)),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** What differs between the original and the repository mesh; empty when they match. */
function differences(original: GlbStructure, repository: GlbStructure): string[] {
  const found: string[] = [];
  if (original.triangles !== repository.triangles) {
    found.push(`triangles ${String(original.triangles)} vs ${String(repository.triangles)}`);
  }
  (["x", "y", "z"] as const).forEach((axis, index) => {
    const before = original.size[index] ?? 0;
    const after = repository.size[index] ?? 0;
    if (Math.abs(before - after) > boundsTolerance) {
      found.push(`${axis} bound ${before.toFixed(3)} vs ${after.toFixed(3)}`);
    }
  });
  return found;
}

const [presetName, ...pairs] = process.argv.slice(2);
const kinds = pairs.map((pair) => {
  const split = pair.indexOf("=");
  return { kind: pair.slice(0, split), original: pair.slice(split + 1), valid: split > 0 };
});
if (presetName === undefined || kinds.length === 0 || kinds.some((entry) => !entry.valid)) {
  console.error("Usage: node scripts/mesh-parity.ts <preset> <kind>=<original.py>...");
  process.exit(1);
}

const differing: string[] = [];
try {
  for (const { kind, original } of kinds) {
    const before = await originalStructure(resolve(original));
    const generated = await generateScriptedMesh(presetName, kind);
    const found = differences(before, generated.structure);
    const result = {
      hash: generated.hash,
      passed: found.length === 0,
      original: { triangles: before.triangles, size: before.size },
      repository: { triangles: generated.structure.triangles, size: generated.structure.size },
      differences: found,
    };
    await writeFile(
      new URL("parity.json", generated.directory),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    console.log(
      `${presetName}/${kind}: ${result.passed ? "parity" : `differs (${found.join("; ")})`}, ` +
        `${String(result.repository.triangles)} triangles, ${fileURLToPath(generated.directory)}`,
    );
    if (!result.passed) differing.push(kind);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
if (differing.length > 0) {
  console.error(`Differing kinds: ${differing.join(", ")}`);
  process.exit(1);
}
