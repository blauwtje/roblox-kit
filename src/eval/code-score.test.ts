import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { codeScoreOf, type CodeScoreInput } from "./code-score.ts";

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
