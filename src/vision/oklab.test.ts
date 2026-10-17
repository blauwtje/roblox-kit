import assert from "node:assert/strict";
import { test } from "node:test";
import { oklabChroma, oklabHueDegrees, oklabToSrgb, srgbToOklab } from "./oklab.ts";

await test("white is lightness 1 with no chroma and black is 0", () => {
  const white = srgbToOklab(1, 1, 1);
  assert.ok(Math.abs(white.l - 1) < 1e-4);
  assert.ok(oklabChroma(white) < 1e-4);
  assert.ok(srgbToOklab(0, 0, 0).l < 1e-6);
});

await test("srgb round trips through oklab", () => {
  const back = oklabToSrgb(srgbToOklab(0.8, 0.3, 0.1));
  assert.ok(Math.abs(back[0] - 0.8) < 1e-4 && Math.abs(back[1] - 0.3) < 1e-4);
  assert.ok(Math.abs(back[2] - 0.1) < 1e-4);
});

await test("pure red has Ottosson's reference lightness and a hue near 29 degrees", () => {
  const red = srgbToOklab(1, 0, 0);
  assert.ok(Math.abs(red.l - 0.628) < 1e-3);
  assert.ok(Math.abs(oklabHueDegrees(red) - 29.2) < 0.5);
});
