import assert from "node:assert/strict";
import { test } from "node:test";
import { nineSliceManifest } from "./nine-slice.ts";

const center = { x0: 20, y0: 20, x1: 108, y1: 44 };

await test("emits the manifest with a 0.5 slice scale", () => {
  assert.deepEqual(nineSliceManifest(128, 64, center), {
    width: 128,
    height: 64,
    sliceCenter: center,
    sliceScale: 0.5,
  });
});

await test("accepts the 1024 px cap and rejects a longer edge", () => {
  nineSliceManifest(1024, 64, center);
  assert.throws(() => nineSliceManifest(1025, 64, center), /exceeds 1024/);
  assert.throws(() => nineSliceManifest(128, 2048, center), /exceeds 1024/);
});

await test("rejects a center outside the image", () => {
  assert.throws(() => nineSliceManifest(128, 64, { ...center, x1: 129 }), /outside/);
  assert.throws(() => nineSliceManifest(128, 64, { ...center, y0: -1 }), /outside/);
});

await test("rejects a zero-size middle", () => {
  assert.throws(() => nineSliceManifest(128, 64, { ...center, x1: 20 }), /middle/);
  assert.throws(() => nineSliceManifest(128, 64, { ...center, y1: 10 }), /middle/);
});

await test("rejects non-positive or fractional sizes", () => {
  assert.throws(() => nineSliceManifest(0, 64, center), /positive/);
  assert.throws(() => nineSliceManifest(12.5, 64, center), /positive/);
});
