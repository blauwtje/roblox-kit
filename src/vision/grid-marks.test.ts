import assert from "node:assert/strict";
import { test } from "node:test";
import type { RgbaImage } from "./encode-png.ts";
import { drawGridMarks } from "./grid-marks.ts";
import type { Region } from "./regions.ts";

const image: RgbaImage = { width: 200, height: 100, data: new Uint8Array(200 * 100 * 4) };
const grid = { columns: 4, rows: 2 };

function alphaAt(overlay: RgbaImage, x: number, y: number): number {
  return overlay.data[(y * overlay.width + x) * 4 + 3] ?? 0;
}

function region(id: number, left: number, right: number): Region {
  return {
    id,
    boxPx: { left, top: 60, right, bottom: 90 },
    cells: [],
    share: 0.1,
    oklab: { l: 0.5, a: 0, b: 0 },
  };
}

await test("the overlay matches the image size and is transparent away from marks", () => {
  const overlay = drawGridMarks(image, grid, []);
  assert.equal(overlay.width, 200);
  assert.equal(overlay.height, 100);
  assert.equal(overlay.data.length, 200 * 100 * 4);
  assert.equal(alphaAt(overlay, 20, 40), 0);
});

await test("grid lines fall on cell borders and each cell gets a label", () => {
  const overlay = drawGridMarks(image, grid, []);
  assert.ok(alphaAt(overlay, 50, 40) > 0);
  assert.ok(alphaAt(overlay, 20, 50) > 0);
  assert.ok(alphaAt(overlay, 3, 3) > 0);
  assert.ok(alphaAt(overlay, 153, 53) > 0);
});

await test("a region number is drawn at the centre of its box and differs by number", () => {
  const one = drawGridMarks(image, grid, [region(1, 20, 60)]);
  const two = drawGridMarks(image, grid, [region(2, 20, 60)]);
  assert.ok(alphaAt(one, 40, 75) > 0);
  assert.notDeepEqual(one.data, two.data);
});
