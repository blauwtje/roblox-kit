import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { codeScoreOf, imageStatsOf, LUMINANCE_BINS, type CodeScoreInput } from "./code-score.ts";

const budget = { maxDrawCalls: config.maxDrawCalls, maxTriangles: config.maxTriangles };
const cleanCounts = { overlapping: 0, floating: 0, unreachable: 0, sizeRule: 0 };

function scoreOf(overrides: Partial<CodeScoreInput> = {}) {
  return codeScoreOf({ counts: cleanCounts, sceneStats: [], budget, ...overrides });
}

await test("a map with no issues and samples within the budget scores 100", () => {
  const sceneStats = [{ zone: "hub", drawCalls: 1000, triangles: 1_000_000 }];
  assert.equal(scoreOf({ sceneStats }), 100);
});

await test("a map with no samples loses nothing for performance", () => {
  assert.equal(scoreOf({ sceneStats: [] }), 100);
});

await test("each issue of any kind costs ten points", () => {
  assert.equal(scoreOf({ counts: { ...cleanCounts, overlapping: 1 } }), 90);
  assert.equal(scoreOf({ counts: { ...cleanCounts, floating: 2, sizeRule: 1 } }), 70);
});

await test("issues alone never take more than 80 points", () => {
  assert.equal(scoreOf({ counts: { ...cleanCounts, unreachable: 500 } }), 20);
});

await test("performance loses points in proportion to the worst sample's overage", () => {
  const sceneStats = [
    { zone: "a", drawCalls: 100, triangles: 100 },
    { zone: "b", drawCalls: 1500, triangles: 100 },
  ];
  assert.equal(scoreOf({ sceneStats }), 90);
});

await test("the triangle overage counts when it is worse than the draw-call overage", () => {
  const sceneStats = [{ zone: "a", drawCalls: 1100, triangles: 1_500_000 }];
  assert.equal(scoreOf({ sceneStats }), 90);
});

await test("performance never takes more than 20 points", () => {
  const sceneStats = [{ zone: "a", drawCalls: 50_000, triangles: 900_000_000 }];
  assert.equal(scoreOf({ sceneStats }), 80);
});

await test("the worst case scores 0 and the score is a whole number", () => {
  const sceneStats = [{ zone: "a", drawCalls: 2000, triangles: 1 }];
  assert.equal(scoreOf({ counts: { ...cleanCounts, floating: 9 }, sceneStats }), 0);
  const tight = [{ zone: "a", drawCalls: 1001, triangles: 1 }];
  assert.equal(Number.isInteger(scoreOf({ sceneStats: tight })), true);
});

await test("the budget of the spec sets the limits", () => {
  const sceneStats = [{ zone: "a", drawCalls: 600, triangles: 1 }];
  assert.equal(scoreOf({ sceneStats, budget: { maxDrawCalls: 400, maxTriangles: 10 } }), 90);
});

function imageOf(width: number, height: number, colorAt: (x: number, y: number) => number[]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [red = 0, green = 0, blue = 0] = colorAt(x, y);
      data.set([red, green, blue, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

await test("a one-color image is all flat color, one luminance bin and no edges", () => {
  const stats = imageStatsOf(imageOf(16, 16, () => [10, 10, 10]));
  assert.equal(stats.flatColorShare, 1);
  assert.equal(stats.luminanceHistogram[0], 1);
  assert.equal(stats.edgeDensity, 0);
});

await test("a black and white checkerboard splits the histogram and has edges at every pixel but the last", () => {
  const stats = imageStatsOf(
    imageOf(8, 8, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0] : [255, 255, 255])),
  );
  assert.equal(stats.flatColorShare, 0.5);
  assert.equal(stats.luminanceHistogram[0], 0.5);
  assert.equal(stats.luminanceHistogram[LUMINANCE_BINS - 1], 0.5);
  assert.equal(stats.edgeDensity, 63 / 64);
});

await test("a smooth gradient is not flat color and has no edges", () => {
  const stats = imageStatsOf(imageOf(256, 4, (x) => [x, x, x]));
  assert.ok(stats.flatColorShare < 0.1);
  assert.equal(stats.edgeDensity, 0);
});
