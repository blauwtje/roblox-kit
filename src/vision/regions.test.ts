import assert from "node:assert/strict";
import { test } from "node:test";
import type { RgbaImage } from "./encode-png.ts";
import { segmentRegions } from "./regions.ts";

const grid = { columns: 4, rows: 2 };

function paint(
  width: number,
  height: number,
  color: (x: number, y: number) => number[],
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++)
    data.set([...color(i % width, Math.floor(i / width)), 255], i * 4);
  return { width, height, data };
}

await test("four colour blocks give regions with ids, shares and a total of one", () => {
  const image = paint(80, 40, (x, y) => [x < 40 ? 220 : 20, y < 20 ? 200 : 30, 60]);
  const regions = segmentRegions(image, grid);
  assert.ok(regions.length >= 12 && regions.length <= 25, `got ${String(regions.length)}`);
  assert.deepEqual(
    regions.map((region) => region.id),
    regions.map((_, index) => index + 1),
  );
  const total = regions.reduce((sum, region) => sum + region.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(regions.every((region, i) => i === 0 || (regions[i - 1]?.share ?? 0) >= region.share));
});

await test("a bright block is one big region reporting its box and grid cells", () => {
  const image = paint(100, 50, (x, y) => (x >= 50 && y >= 25 ? [255, 255, 255] : [0, 0, 0]));
  const regions = segmentRegions(image, grid);
  const bright = regions.filter((region) => region.oklab.l > 0.9);
  assert.ok(bright.length > 0);
  const box = bright.reduce(
    (acc, region) => ({
      left: Math.min(acc.left, region.boxPx.left),
      top: Math.min(acc.top, region.boxPx.top),
      right: Math.max(acc.right, region.boxPx.right),
      bottom: Math.max(acc.bottom, region.boxPx.bottom),
    }),
    { left: 1e9, top: 1e9, right: 0, bottom: 0 },
  );
  assert.ok(box.left >= 40 && box.top >= 20 && box.right <= 100 && box.bottom <= 50);
  const cells = new Set(bright.flatMap((region) => region.cells));
  assert.deepEqual([...cells].sort(), ["C2", "D2"]);
  assert.ok(bright.reduce((sum, region) => sum + region.share, 0) > 0.2);
});

await test("a flat image still yields in-range regions inside the image", () => {
  const regions = segmentRegions(
    paint(30, 30, () => [90, 90, 90]),
    grid,
  );
  assert.ok(regions.length >= 12 && regions.length <= 25);
  assert.ok(regions.every((region) => region.boxPx.right <= 30 && region.boxPx.bottom <= 30));
});

await test("the same image segments the same way twice", () => {
  const image = paint(64, 64, (x, y) => [x * 4, y * 4, (x * y) % 256]);
  assert.deepEqual(segmentRegions(image, grid), segmentRegions(image, grid));
});
