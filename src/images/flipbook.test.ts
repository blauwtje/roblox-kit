import assert from "node:assert/strict";
import { test } from "node:test";
import type { RgbaImage } from "../vision/encode-png.ts";
import { composeFlipbook } from "./flipbook.ts";

const frame = (size: number, value: number): RgbaImage => {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([value, 0, 0, 255], i * 4);
  return { width: size, height: size, data };
};

await test("places frames row-major in a square sheet", () => {
  const sheet = composeFlipbook(
    [1, 2, 3, 4].map((v) => frame(4, v)),
    "Grid2x2",
  );
  assert.equal(sheet.width, 8);
  assert.equal(sheet.height, 8);
  const red = (x: number, y: number) => sheet.data[(y * 8 + x) * 4];
  assert.deepEqual([red(0, 0), red(4, 0), red(0, 4), red(7, 7)], [1, 2, 3, 4]);
});

await test("bleeds transparent pixels with the neighbor color", () => {
  const clear = frame(4, 0);
  clear.data.fill(0);
  clear.data.set([9, 8, 7, 255], 0);
  const sheet = composeFlipbook([clear, frame(4, 2), frame(4, 3), frame(4, 4)], "Grid2x2");
  assert.deepEqual([...sheet.data.subarray(4, 8)], [9, 8, 7, 0]);
});

await test("a wrong frame count names the allowed counts", () => {
  assert.throws(() => composeFlipbook([frame(4, 1)], "Grid2x2"), /4, 16, 64/);
});

await test("a wrong frame size fails", () => {
  const frames = [frame(4, 1), frame(4, 1), frame(4, 1), frame(2, 1)];
  assert.throws(() => composeFlipbook(frames, "Grid2x2"), /4x4/);
});

await test("a sheet outside 8 to 1024 px fails", () => {
  const frames = Array.from({ length: 4 }, () => frame(2, 1));
  assert.throws(() => composeFlipbook(frames, "Grid2x2"), /power of two/);
  const big = Array.from({ length: 4 }, () => frame(513, 1));
  assert.throws(() => composeFlipbook(big, "Grid2x2"), /power of two/);
});
