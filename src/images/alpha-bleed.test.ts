import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeImage } from "../vision/decode-image.ts";
import type { RgbaImage } from "../vision/encode-png.ts";
import { alphaBleed } from "./alpha-bleed.ts";
import { renderSvg } from "./render-svg.ts";

const strip = (width: number): RgbaImage => {
  const data = new Uint8Array(width * 4);
  data.set([200, 10, 20, 255], 0);
  for (let x = 1; x < width; x++) data.set([0, 255, 0, 0], x * 4);
  return { width, height: 1, data };
};

await test("transparent pixels take the nearest opaque color and keep alpha", () => {
  const out = alphaBleed(strip(5), { passes: 8 });
  for (let x = 0; x < 5; x++) {
    assert.deepEqual([...out.data.subarray(x * 4, x * 4 + 3)], [200, 10, 20]);
    assert.equal(out.data[x * 4 + 3], x === 0 ? 255 : 0);
  }
});

await test("bleeds only as many pixels as passes", () => {
  const out = alphaBleed(strip(40), { passes: 8 });
  assert.equal(out.data[8 * 4], 200);
  assert.equal(out.data[9 * 4], 0);
  assert.equal(out.data[9 * 4 + 1], 255);
});

await test("nearest of two colors wins and the input is not changed", () => {
  const image = strip(7);
  image.data.set([1, 2, 3, 255], 6 * 4);
  const before = Uint8Array.from(image.data);
  const out = alphaBleed(image);
  assert.deepEqual(image.data, before);
  assert.equal(out.data[1 * 4], 200);
  assert.equal(out.data[5 * 4], 1);
});

await test("rejects passes outside 8 to 32", () => {
  assert.throws(() => alphaBleed(strip(3), { passes: 4 }), /passes/);
  assert.throws(() => alphaBleed(strip(3), { passes: 33 }), /passes/);
});

await test("a 1024 by 1024 bleed takes under 300 ms", () => {
  const size = 1024;
  const data = new Uint8Array(size * size * 4);
  for (let y = 480; y < 544; y++)
    for (let x = 480; x < 544; x++) data.set([9, 9, 9, 255], (y * size + x) * 4);
  alphaBleed({ width: size, height: size, data }, { passes: 32 });
  const start = performance.now();
  alphaBleed({ width: size, height: size, data }, { passes: 32 });
  assert.ok(performance.now() - start < 300);
});

await test("renderSvg output has bled color under transparent edges", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="8" y="8" width="4" height="4" fill="#ff0000"/></svg>`;
  const image = decodeImage(renderSvg(svg).png);
  const corner = [...image.data.subarray(0, 4)];
  assert.deepEqual(corner, [255, 0, 0, 0]);
});
