import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { GlbStructure } from "./glb-structure.ts";
import { scriptedMeshHash, scriptedMeshProblems } from "./generate-scripted-mesh.ts";
import { recipeHash } from "./recipe-hash.ts";

const script = "src/hero-props/meshes/train-station/pillar.py";
const declaration = { script, targets: [{ replaces: "prop:pillar" }] };

await test("a declared mesh's hash covers its script path, its source and shared.py", async () => {
  const source = await readFile(new URL(`../../${script}`, import.meta.url), "utf8");
  const shared = await readFile(new URL("./meshes/shared.py", import.meta.url), "utf8");
  assert.equal(
    await scriptedMeshHash("pillar", declaration),
    recipeHash({ kind: "pillar", script }, `${source}\0${shared}`),
  );
  assert.notEqual(
    await scriptedMeshHash("pillar", declaration),
    await scriptedMeshHash("column", declaration),
  );
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
