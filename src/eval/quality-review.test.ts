import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { config } from "../config.ts";
import {
  axisMedians,
  mergedDefects,
  qualityBrief,
  reachesPassScore,
  type QualityAnswer,
} from "./quality-review.ts";

const promptUrl = new URL("../../skills/visual-judge/quality-prompt.md", import.meta.url);

function answer(scores: number[], defects: QualityAnswer["defects"] = []): QualityAnswer {
  const [scale = 1, rotation = 1, placement = 1, materials = 1, lighting = 1] = scores;
  const axis = (score: number) => ({ evidence: "", score });
  return {
    scale: axis(scale),
    rotation: axis(rotation),
    placement: axis(placement),
    materials: axis(materials),
    lighting: axis(lighting),
    defects,
  };
}

await test("the brief fills the four fields and carries nothing of the prompt's notes or the spec", async () => {
  const brief = qualityBrief(
    await readFile(promptUrl, "utf8"),
    "train-station",
    "platform",
    ["reference-1.png", "reference-2.png"],
    ["capture-1.png", "capture-2.png", "capture-3.png"],
  );
  assert.match(brief, /^You are a level-art reviewer/);
  assert.match(brief, /The room is a `train-station` map's `platform`\./);
  assert.match(brief, /reference-1\.png\nreference-2\.png/);
  assert.match(brief, /capture-1\.png\ncapture-2\.png\ncapture-3\.png/);
  assert.doesNotMatch(brief, /<genre>|<room type>|<reference paths>|<capture paths>/);
  assert.doesNotMatch(brief, /eval:studio|calibration|pass score/);
});

await test("a prompt without a rule before the brief is rejected", () => {
  assert.throws(() => qualityBrief("No rule here", "g", "r", [], []), /no "---" rule/);
});

await test("each axis takes the median of the three reviewers, so one outlier moves nothing", () => {
  const medians = axisMedians([
    answer([9, 2, 7, 3, 8]),
    answer([8, 3, 1, 4, 8]),
    answer([2, 10, 7, 9, 1]),
  ]);
  assert.deepEqual(medians, { scale: 8, rotation: 3, placement: 7, materials: 4, lighting: 8 });
});

await test("a room passes only when every axis median reaches the pass score", () => {
  const passing = { scale: 7, rotation: 8, placement: 9, materials: 10, lighting: 7 };
  assert.equal(config.visualPassScore, 7);
  assert.equal(reachesPassScore(passing), true);
  assert.equal(reachesPassScore({ ...passing, lighting: 6 }), false);
  assert.equal(reachesPassScore({ ...passing, scale: 1 }), false);
});

await test("defects from all reviewers are kept once each, in reviewer order", () => {
  const bench = { piece: "bench", problem: "lies on its side", where: "platform center" };
  const sign = { piece: "sign", problem: "floats", where: "north wall" };
  const merged = mergedDefects([answer([], [bench]), answer([], [sign, bench]), answer([])]);
  assert.deepEqual(merged, [bench, sign]);
});
