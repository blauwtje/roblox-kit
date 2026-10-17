import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDepth, frameRho, spearman, type DepthEvalFrame } from "./depth-eval.ts";
import { visionConfig } from "./vision-config.ts";

const truth = Array.from({ length: 18 }, (_, r) => Array.from({ length: 32 }, () => 10 + r * 5));
const good = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, () => r));
const flat = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 3));
const reversed = [...good].reverse();

function frames(count: number, model: number[][], ms = 100): DepthEvalFrame[] {
  return Array.from({ length: count }, () => ({
    truth,
    heuristic: { cells: flat, ms: 1 },
    model: { cells: model, ms },
  }));
}

await test("spearman handles ties, order and constants", () => {
  assert.equal(spearman([1, 2, 3], [10, 20, 30]), 1);
  assert.equal(spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), 0);
});

await test("frameRho compares on the source grid", () => {
  assert.ok(frameRho(truth, good) > 0.8);
  assert.ok(frameRho(truth, reversed) < 0);
});

await test("ships a model that is accurate, ahead and fast", () => {
  const result = evaluateDepth(frames(visionConfig.depthEvalMinFrames, good));
  assert.equal(result.verdict, "ship");
  assert.deepEqual(
    result.arms.map((a) => [a.arm, a.frames]),
    [
      ["heuristic", 40],
      ["model", 40],
    ],
  );
  assert.equal(result.arms[1]?.winShare, 1);
  assert.equal(result.arms[1].medianMs, 100);
});

await test("leaves out a slow or inaccurate model", () => {
  assert.equal(evaluateDepth(frames(40, good, 3001)).verdict, "leave-out");
  assert.equal(evaluateDepth(frames(40, reversed)).verdict, "leave-out");
});

await test("reports insufficient data for few frames or no model", () => {
  assert.equal(evaluateDepth(frames(39, good)).verdict, "insufficient-data");
  const noModel = frames(40, good).map(({ truth: t, heuristic }) => ({ truth: t, heuristic }));
  const result = evaluateDepth(noModel);
  assert.equal(result.verdict, "insufficient-data");
  assert.equal(result.arms.length, 1);
  assert.equal(evaluateDepth([]).verdict, "insufficient-data");
});
