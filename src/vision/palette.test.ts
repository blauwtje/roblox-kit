import assert from "node:assert/strict";
import { test } from "node:test";
import type { RgbaImage } from "./encode-png.ts";
import { extractPalette } from "./palette.ts";

function stripes(colors: number[][], widths: number[], height = 10): RgbaImage {
  const width = widths.reduce((sum, value) => sum + value, 0);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    let x = 0;
    colors.forEach((color, index) => {
      for (let i = 0; i < (widths[index] ?? 0); i++, x++) {
        data.set([...color, 255], (y * width + x) * 4);
      }
    });
  }
  return { width, height, data };
}

await test("a three-color image gives those colors sorted by share", () => {
  const palette = extractPalette(
    stripes(
      [
        [255, 0, 0],
        [0, 0, 255],
        [255, 255, 255],
      ],
      [20, 60, 20],
    ),
    3,
  );
  assert.deepEqual(
    palette.map((color) => color.srgbHex),
    ["#0000ff", "#ff0000", "#ffffff"],
  );
  assert.ok(Math.abs((palette[0]?.share ?? 0) - 0.6) < 1e-9);
  assert.ok(Math.abs((palette[0]?.hueDegrees ?? 0) - 264) < 1);
  assert.equal(palette[2]?.materialGuess, "SmoothPlastic");
});

await test("the same image and seed give the same palette", () => {
  const image = stripes(
    [
      [200, 30, 30],
      [30, 200, 30],
      [30, 30, 200],
      [90, 60, 40],
    ],
    [30, 30, 30, 30],
  );
  assert.deepEqual(extractPalette(image), extractPalette(image));
});

await test("transparent pixels are ignored and an empty image gives no colors", () => {
  assert.deepEqual(extractPalette({ width: 1, height: 1, data: new Uint8Array(4) }), []);
});

await test("a large image is downsampled but keeps its shares", () => {
  const palette = extractPalette(
    stripes(
      [
        [0, 0, 0],
        [255, 255, 255],
      ],
      [300, 100],
      40,
    ),
    2,
  );
  assert.ok(Math.abs((palette[0]?.share ?? 0) - 0.75) < 0.05);
});
