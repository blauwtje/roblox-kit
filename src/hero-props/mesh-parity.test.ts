import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { config } from "../config.ts";
import { scriptedMeshHash } from "./generate-scripted-mesh.ts";
import type { GlbStructure } from "./glb-structure.ts";
import { readHeroAssets } from "./hero-asset-store.ts";
import {
  baseMeshSources,
  currentMeshFiles,
  meshDifferences,
  meshFilesHash,
  rekeyMesh,
  sameMeshFiles,
} from "./mesh-parity.ts";

const script = "src/hero-props/meshes/train-station/pillar.py";
const root = new URL("../../", import.meta.url);

async function fakeGit(args: string[]): Promise<string> {
  if (args[0] === "ls-tree") {
    return "src/hero-props/meshes/shared.py\nsrc/hero-props/meshes/train-station/bench.py\n";
  }
  const path = (args[1] ?? "").split(":")[1] ?? "";
  return await readFile(new URL(path, root), "utf8");
}

await test("a base tree of identical sources hashes like the current mesh and skips Blender", async () => {
  const base = await baseMeshSources("HEAD", script, fakeGit);
  try {
    const current = await currentMeshFiles(script);
    assert.ok(sameMeshFiles(base.files, current));
    assert.equal(
      await meshFilesHash("pillar", script, base.files),
      await scriptedMeshHash("pillar", { script, targets: [{ replaces: "prop:pillar" }] }),
    );
    assert.equal(
      await readFile(join(base.directory, "src/hero-props/meshes/shared.py"), "utf8"),
      base.files["src/hero-props/meshes/shared.py"],
    );
    assert.equal(sameMeshFiles(base.files, { ...current, [script]: "# edited\n" }), false);
  } finally {
    await rm(base.directory, { recursive: true, force: true });
  }
});

function solidPng(width: number, height: number, level: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, level)]);
  const chunk = (type: string, body: Buffer): Buffer => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "latin1");
    body.copy(out, 8);
    return out;
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const structure: GlbStructure = {
  triangles: 1200,
  size: [2, 16, 2],
  meshNames: ["pillar"],
  materialNames: ["pillar"],
  materialMaps: [["color", "normal", "roughness-metalness"]],
  imageBytes: [solidPng(4, 4, 10)],
};

await test("meshes differ by triangles, bounds beyond 0.01, materials, maps and image hashes", () => {
  assert.deepEqual(meshDifferences(structure, { ...structure, size: [2.009, 16, 2] }), []);
  const changed: GlbStructure = {
    ...structure,
    triangles: 1204,
    size: [2, 16.02, 2],
    materialNames: ["steel"],
    materialMaps: [["color"]],
  };
  const found = meshDifferences(structure, changed).join("; ");
  assert.match(found, /triangles 1200 vs 1204/);
  assert.match(found, /y bound 16\.000 vs 16\.020/);
  assert.match(found, /material names \["pillar"\] vs \["steel"\]/);
  assert.match(found, /material maps/);
});

await test("rekeyMesh moves the base record only for a passed parity", async () => {
  const folder = await mkdtemp(join(tmpdir(), "mesh-rekey-"));
  try {
    const file = pathToFileURL(join(folder, "hero-assets.json"));
    await writeFile(file, JSON.stringify({ base: { kind: "pillar", assetId: "123" } }));
    const parity = { hash: "next", baseHash: "base", passed: false, differences: ["x bound"] };
    await assert.rejects(rekeyMesh(parity, file), /did not pass parity: x bound/);
    assert.deepEqual(Object.keys(await readHeroAssets(file)), ["base"]);
    assert.equal(await rekeyMesh({ ...parity, passed: true, differences: [] }, file), "moved");
    assert.deepEqual(await readHeroAssets(file), { next: { kind: "pillar", assetId: "123" } });
    assert.equal(await rekeyMesh({ ...parity, passed: true, differences: [] }, file), "unchanged");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

await test("image pixels may differ by bake noise but not by a real change or a size change", () => {
  const tolerance = config.heroPropImageTolerance;
  const withImage = (bytes: Uint8Array): GlbStructure => ({ ...structure, imageBytes: [bytes] });
  const noisy = withImage(solidPng(4, 4, 10 + Math.floor(tolerance)));
  assert.deepEqual(meshDifferences(structure, noisy), []);
  const changed = withImage(solidPng(4, 4, 255));
  assert.match(meshDifferences(structure, changed).join("; "), /image 0 pixels differ/);
  const resized = withImage(solidPng(8, 4, 10));
  assert.match(meshDifferences(structure, resized).join("; "), /image 0 size 4x4x3 vs 8x4x3/);
  assert.match(
    meshDifferences(structure, { ...structure, imageBytes: [] }).join("; "),
    /image count 1 vs 0/,
  );
});
