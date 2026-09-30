import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import jpeg from "jpeg-js";
import { isBlankImage, type RgbaImage } from "./viewport-preflight.ts";

const width = 100;
const height = 100;

function imageOf(colorAt: (pixel: number) => [number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    data.set([...colorAt(pixel), 255], pixel * 4);
  }
  return { width, height, data };
}

await test("a flat dark image with a few stray bright pixels is blank", () => {
  const image = imageOf((pixel) => (pixel % 200 === 0 ? [240, 240, 240] : [26, 26, 26]));
  assert.equal(isBlankImage(image), true);
});

await test("an image with JPEG-level noise around one color is blank", () => {
  const image = imageOf((pixel) => {
    const shade = 26 + (pixel % 7) - 3;
    return [shade, shade, shade];
  });
  assert.equal(isBlankImage(image), true);
});

await test("a dark scene with a lit half is not blank", () => {
  const image = imageOf((pixel) => (pixel < (width * height) / 2 ? [20, 20, 30] : [140, 120, 90]));
  assert.equal(isBlankImage(image), false);
});

await test("a gradient is not blank, however dark its mean", () => {
  const image = imageOf((pixel) => {
    const shade = Math.floor((pixel / (width * height)) * 80);
    return [shade, shade, shade];
  });
  assert.equal(isBlankImage(image), false);
});

await test("a real room capture is not blank", async () => {
  const bytes = await readFile(new URL("../../eval/anchors/bad/concourse.jpg", import.meta.url));
  assert.equal(isBlankImage(jpeg.decode(bytes, { useTArray: true })), false);
});
