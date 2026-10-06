import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { checkGlbParts, readGlbParts, readGlbStructure } from "./glb-structure.ts";

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
  materials: [
    {
      name: "shell",
      normalTexture: { index: 1 },
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicRoughnessTexture: { index: 2 },
      },
    },
    { name: "glass", pbrMetallicRoughness: { baseColorTexture: { index: 3 } } },
  ],
};

await test("reads the triangles, size and names of a GLB", () => {
  const structure = readGlbStructure(assembleGlb(twoMeshGltf));
  assert.deepEqual(structure, {
    triangles: 13,
    size: [5, 2, 4],
    meshNames: ["body", "roof"],
    materialNames: ["shell", "glass"],
    materialMaps: [["color", "normal", "roughness-metalness"], ["color"]],
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

const BIN_CHUNK_TYPE = 0x004e4942;

type Box = { min: [number, number, number]; max: [number, number, number]; inverted?: boolean };

/** The flat-shaded triangles of a box, six vertices per face, wound outward unless `inverted`. */
function boxPositions({ min, max, inverted = false }: Box): number[] {
  const corners = [min, max];
  const positions: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [0, 1]) {
      // u x v points along +axis; the max side keeps that order, the min side swaps it.
      let [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
      if ((side === 0) !== inverted) [u, v] = [v, u];
      const point = (uSide: number, vSide: number): number[] => {
        const vertex = [0, 0, 0];
        vertex[axis] = corners[side]?.[axis] ?? 0;
        vertex[u] = corners[uSide]?.[u] ?? 0;
        vertex[v] = corners[vSide]?.[v] ?? 0;
        return vertex;
      };
      const quad = [point(0, 0), point(1, 0), point(1, 1), point(0, 1)];
      for (const corner of [0, 1, 2, 0, 2, 3]) positions.push(...(quad[corner] ?? []));
    }
  }
  return positions;
}

/** Assembles a GLB with one non-indexed mesh per entry of `meshes`, each joining its boxes. */
function assembleBoxGlb(meshes: Record<string, Box[]>): Uint8Array {
  const floats = Object.values(meshes).map(
    (boxes) => new Float32Array(boxes.flatMap(boxPositions)),
  );
  const bin = new Uint8Array(floats.reduce((total, array) => total + array.byteLength, 0));
  const gltf = {
    asset: { version: "2.0" },
    accessors: [] as object[],
    bufferViews: [] as object[],
    meshes: [] as object[],
  };
  let offset = 0;
  Object.keys(meshes).forEach((name, index) => {
    const array = floats[index] ?? new Float32Array();
    bin.set(new Uint8Array(array.buffer), offset);
    gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: array.byteLength });
    gltf.accessors.push({
      bufferView: index,
      componentType: 5126,
      count: array.length / 3,
      type: "VEC3",
    });
    gltf.meshes.push({ name, primitives: [{ attributes: { POSITION: index } }] });
    offset += array.byteLength;
  });
  const json = assembleGlb(gltf).subarray(12);
  const glb = new Uint8Array(12 + json.length + 8 + bin.length);
  const view = new DataView(glb.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, glb.length, true);
  glb.set(json, 12);
  view.setUint32(12 + json.length, bin.length, true);
  view.setUint32(16 + json.length, BIN_CHUNK_TYPE, true);
  glb.set(bin, 20 + json.length);
  return glb;
}

const tolerance = config.heroPropContactToleranceStuds;

await test("splits a joined mesh into closed, outward parts with their bounds", () => {
  const parts = readGlbParts(
    assembleBoxGlb({
      body: [
        { min: [0, 0, 0], max: [2, 1, 1] },
        { min: [5, 0, 0], max: [6, 3, 1] },
      ],
    }),
  );
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[1]?.min, [5, 0, 0]);
  assert.deepEqual(parts[1].max, [6, 3, 1]);
  assert.ok(parts.every((part) => part.closed));
  assert.ok(Math.abs((parts[0]?.signedVolume ?? 0) - 2) < 1e-6);
  assert.deepEqual(checkGlbParts(parts, tolerance), {
    passed: true,
    parts: 2,
    floatingParts: [],
    invertedParts: [],
  });
});

await test("a part resting on a grounded part passes, a part in the air does not", () => {
  const checks = checkGlbParts(
    readGlbParts(
      assembleBoxGlb({
        base: [{ min: [0, 0, 0], max: [2, 1, 2] }],
        trim: [
          { min: [0.5, 1, 0.5], max: [1.5, 2, 1.5] },
          { min: [0, 3, 0], max: [1, 4, 1] },
        ],
      }),
    ),
    tolerance,
  );
  assert.deepEqual(checks, {
    passed: false,
    parts: 3,
    floatingParts: ["trim#2"],
    invertedParts: [],
  });
});

await test("a closed part wound inward fails as inverted", () => {
  const checks = checkGlbParts(
    readGlbParts(
      assembleBoxGlb({
        body: [{ min: [0, 0, 0], max: [1, 1, 1] }],
        glass: [{ min: [1, 0, 0], max: [2, 1, 1], inverted: true }],
      }),
    ),
    tolerance,
  );
  assert.deepEqual(checks, {
    passed: false,
    parts: 2,
    floatingParts: [],
    invertedParts: ["glass#1"],
  });
});

await test("an open part is not judged for winding", () => {
  const glb = assembleBoxGlb({ body: [{ min: [0, 0, 0], max: [1, 1, 1], inverted: true }] });
  const [part] = readGlbParts(glb);
  assert.ok(part !== undefined);
  const open = { ...part, closed: false };
  assert.equal(checkGlbParts([open], tolerance).passed, true);
  assert.equal(checkGlbParts([part], tolerance).passed, false);
});

await test("reading parts needs the BIN chunk", () => {
  assert.throws(() => readGlbParts(assembleGlb(twoMeshGltf)), /BIN chunk/);
});
