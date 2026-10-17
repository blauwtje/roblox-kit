import assert from "node:assert/strict";
import { test } from "node:test";
import type { GlbStructure } from "./glb-structure.ts";
import {
  scriptedMeshHash,
  scriptedMeshProblems,
  type MeshSourceReader,
} from "./generate-scripted-mesh.ts";

const script = "src/hero-props/meshes/train-station/pillar.py";
const declaration = { script, targets: [{ replaces: "prop:pillar" }] };

function readerOf(files: Record<string, string>): MeshSourceReader {
  return {
    list: () => Promise.resolve(Object.keys(files)),
    read: (path) => Promise.resolve(files[path] ?? ""),
  };
}

const tree = {
  "shared.py": "shared",
  "lib/wood.py": "wood",
  "train-station/pillar.py": "pillar",
  "train-station/bench.py": "bench",
};
const bench = { script: "src/hero-props/meshes/train-station/bench.py", targets: [] };

await test("a library edit changes every hash, a script edit one, an unchanged tree none", async () => {
  const hashes = async (files: Record<string, string>) => [
    await scriptedMeshHash("pillar", declaration, readerOf(files)),
    await scriptedMeshHash("bench", bench, readerOf(files)),
  ];
  const before = await hashes(tree);
  assert.deepEqual(await hashes({ ...tree }), before);
  const library = await hashes({ ...tree, "lib/wood.py": "wood2" });
  assert.notEqual(library[0], before[0]);
  assert.notEqual(library[1], before[1]);
  const shared = await hashes({ ...tree, "shared.py": "shared2" });
  assert.notEqual(shared[0], before[0]);
  const edited = await hashes({ ...tree, "train-station/bench.py": "bench2" });
  assert.equal(edited[0], before[0]);
  assert.notEqual(edited[1], before[1]);
});

await test("the real mesh library hashes deterministically", async () => {
  assert.equal(
    await scriptedMeshHash("pillar", declaration),
    await scriptedMeshHash("pillar", declaration),
  );
});

await test("a print svg adds its text and named fonts to the hash, a mesh without one keeps it", async () => {
  const svg = (family: string, word: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="${family}">${word}</text></svg>`;
  const files = { ...tree, "train-station/pillar.print.svg": svg("Gelasio", "A") };
  const hash = (all: Record<string, string>) =>
    scriptedMeshHash("pillar", declaration, readerOf(all));
  const plain = await hash(tree);
  const printed = await hash(files);
  assert.notEqual(printed, plain);
  const word = await hash({ ...files, "train-station/pillar.print.svg": svg("Gelasio", "B") });
  assert.notEqual(word, printed);
  const font = await hash({ ...files, "train-station/pillar.print.svg": svg("Inter", "A") });
  assert.notEqual(font, printed);
  const other = await hash({ ...tree, "train-station/bench.print.svg": svg("Gelasio", "A") });
  assert.equal(other, plain);
  const helper = { ...tree, "lib/wood.py": "wood\n\ndef print_image(path):\n    return path\n" };
  assert.equal(await hash(helper), plain);
  const withHelper = await hash({
    ...helper,
    "train-station/pillar.print.svg": svg("Gelasio", "A"),
  });
  assert.notEqual(withHelper, printed);
});

const structure: GlbStructure = {
  triangles: 1200,
  size: [2, 16, 2],
  meshNames: ["pillar"],
  materialNames: ["pillar"],
  materialMaps: [["color", "normal", "roughness-metalness"]],
};

await test("a baked mesh within the limit has no problems", () => {
  assert.deepEqual(scriptedMeshProblems(structure), []);
});

await test("a mesh with no mesh, too many triangles or a missing map is named", () => {
  const broken = {
    ...structure,
    triangles: 20001,
    meshNames: [],
    materialMaps: [["color"]],
  } as GlbStructure;
  const problems = scriptedMeshProblems(broken).join("; ");
  assert.match(problems, /no mesh/);
  assert.match(problems, /20001 triangles/);
  assert.match(problems, /no normal map/);
  assert.match(problems, /no roughness-metalness map/);
});
