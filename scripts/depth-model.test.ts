import assert from "node:assert/strict";
import { test } from "node:test";
import { inverseDepthToGrid, preprocess, sha256Hex } from "./depth-model.ts";

await test("inverse depth becomes a 0 to 9 grid with the nearest cells at 0 (left near, right far)", () => {
  const width = 16;
  const height = 16;
  const values = Array.from({ length: width * height }, (_, i) => (i % width < 8 ? 10 : 1));
  const cells = inverseDepthToGrid(values, width, height);
  assert.equal(cells.length, 8);
  assert.deepEqual(cells[0], [0, 0, 0, 0, 9, 9, 9, 9]);
});

await test("a flat inverse depth map gives one mid level", () => {
  const cells = inverseDepthToGrid(new Float32Array(64).fill(3), 8, 8);
  assert.ok(cells.flat().every((v) => v === cells[0]?.[0] && v >= 0 && v <= 9));
});

await test("preprocess returns normalized planar RGB at the requested size", () => {
  const image = { width: 2, height: 2, data: new Uint8Array(16).fill(255) };
  const out = preprocess(image, 4);
  assert.equal(out.length, 3 * 16);
  assert.ok(Math.abs((out[0] ?? 0) - (1 - 0.485) / 0.229) < 1e-5);
  assert.ok(Math.abs((out[16] ?? 0) - (1 - 0.456) / 0.224) < 1e-5);
});

await test("sha256Hex matches the known digest of 'abc'", () => {
  assert.equal(
    sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
