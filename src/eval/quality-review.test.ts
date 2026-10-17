import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import {
  axisEvidence,
  axisMedians,
  reachesPassScore,
  type QualityAnswer,
} from "./quality-review.ts";

function answer(scores: number[]): QualityAnswer {
  const [
    palette = 1,
    focalHierarchy = 1,
    negativeSpace = 1,
    readability = 1,
    atmosphere = 1,
    lighting = 1,
  ] = scores;
  const note = (score: number) => ({ evidence: `capture-1 shows a ${String(score)}.`, score });
  return {
    palette: note(palette),
    focalHierarchy: note(focalHierarchy),
    negativeSpace: note(negativeSpace),
    readability: note(readability),
    atmosphere: note(atmosphere),
    lighting: note(lighting),
  };
}

await test("one outlier reviewer moves no axis median, and evidence is kept per reviewer", () => {
  const answers = [
    answer([9, 2, 7, 3, 8, 5]),
    answer([8, 3, 1, 4, 8, 6]),
    answer([2, 10, 7, 9, 1, 10]),
  ];
  assert.deepEqual(axisMedians(answers), {
    palette: 8,
    focalHierarchy: 3,
    negativeSpace: 7,
    readability: 4,
    atmosphere: 8,
    lighting: 6,
  });
  assert.deepEqual(axisEvidence(answers.slice(0, 2)).palette, [
    "capture-1 shows a 9.",
    "capture-1 shows a 8.",
  ]);
});

await test("a room passes only when every axis reaches the pass score, so one weak axis fails it", () => {
  const passing = axisMedians([answer([7, 8, 9, 10, 7, 7])]);
  assert.equal(config.visualPassScore, 7);
  assert.equal(reachesPassScore(passing), true);
  for (const axis of Object.keys(passing) as (keyof typeof passing)[]) {
    assert.equal(reachesPassScore({ ...passing, [axis]: 6 }), false, axis);
  }
});
