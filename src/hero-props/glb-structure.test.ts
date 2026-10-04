import assert from "node:assert/strict";
import { test } from "node:test";
import { readGlbStructure } from "./glb-structure.ts";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;

/** Assembles a GLB holding only the JSON chunk, which is all the reader looks at. */
function assembleGlb(gltf: object): Uint8Array {
  const padded = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonBytes = Math.ceil(padded.length / 4) * 4;
  const glb = new Uint8Array(20 + jsonBytes).fill(0x20);
  const view = new DataView(glb.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, glb.length, true);
  view.setUint32(12, jsonBytes, true);
  view.setUint32(16, JSON_CHUNK_TYPE, true);
  glb.set(padded, 20);
  return glb;
}

const twoMeshGltf = {
  asset: { version: "2.0" },
  accessors: [
    { count: 24, type: "VEC3", min: [-1, 0, -2], max: [1, 2, 2] },
    { count: 36, type: "SCALAR" },
    { count: 3, type: "VEC3", min: [0, 0, 0], max: [4, 1, 1] },
  ],
  meshes: [
    { name: "body", primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
    { name: "roof", primitives: [{ attributes: { POSITION: 2 } }] },
  ],
  materials: [{ name: "shell" }, { name: "glass" }],
};

await test("reads the triangles, size and names of a GLB", () => {
  const structure = readGlbStructure(assembleGlb(twoMeshGltf));
  assert.deepEqual(structure, {
    triangles: 13,
    size: [5, 2, 4],
    meshNames: ["body", "roof"],
    materialNames: ["shell", "glass"],
  });
});

await test("rejects a file that is not a GLB", () => {
  assert.throws(() => readGlbStructure(new Uint8Array(32)), /magic/);
});

await test("rejects a position accessor without bounds", () => {
  const gltf = {
    ...twoMeshGltf,
    accessors: [{ count: 3, type: "VEC3" }],
    meshes: [{ name: "body", primitives: [{ attributes: { POSITION: 0 } }] }],
  };
  assert.throws(() => readGlbStructure(assembleGlb(gltf)), /no min and max/);
});

await test("rejects a primitive that is not a triangle list", () => {
  const gltf = {
    ...twoMeshGltf,
    meshes: [{ name: "body", primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] }],
  };
  assert.throws(() => readGlbStructure(assembleGlb(gltf)), /triangle list/);
});
