import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { config } from "../config.ts";
import {
  axisMedians,
  qualityAxes,
  qualityBrief,
  reachesPassScore,
  type QualityAnswer,
} from "./quality-review.ts";

const promptUrl = new URL("../../skills/visual-judge/quality-prompt.md", import.meta.url);

function answer(scores: number[]): QualityAnswer {
  const [
    palette = 1,
    focalHierarchy = 1,
    negativeSpace = 1,
    readability = 1,
    atmosphere = 1,
    lighting = 1,
  ] = scores;
  return { palette, focalHierarchy, negativeSpace, readability, atmosphere, lighting };
}

await test("the brief fills the five fields and carries nothing of the prompt's notes or the spec", async () => {
  const brief = qualityBrief(
    await readFile(promptUrl, "utf8"),
    "train-station",
    "platform",
    "bright and even overhead light with crisp shadows",
    ["reference-1.png", "reference-2.png"],
    ["capture-1.png", "capture-2.png", "capture-3.png"],
  );
  assert.match(brief, /^You are a level-art reviewer/);
  assert.match(brief, /The room is a `train-station` map's `platform`\./);
  assert.match(
    brief,
    /Its lighting intent is: bright and even overhead light with crisp shadows\./,
  );
  assert.match(brief, /reference-1\.png\nreference-2\.png/);
  assert.match(brief, /capture-1\.png\ncapture-2\.png\ncapture-3\.png/);
  assert.doesNotMatch(
    brief,
    /<genre>|<room type>|<lighting intent>|<reference paths>|<capture paths>/,
  );
  assert.doesNotMatch(brief, /eval:studio|calibration|pass score|check_map/);
});

await test("the brief names every axis the answer is scored on", async () => {
  const promptText = await readFile(promptUrl, "utf8");
  const brief = qualityBrief(promptText, "g", "r", "dim", [], []);
  for (const axis of qualityAxes) {
    assert.match(brief, new RegExp(`\\*\\*${axis}\\*\\*`));
    assert.match(brief, new RegExp(`"${axis}": 1`));
  }
});

await test("a prompt without a rule before the brief is rejected", () => {
  assert.throws(() => qualityBrief("No rule here", "g", "r", "dim", [], []), /no "---" rule/);
});

await test("each axis takes the median of the three reviewers, so one outlier moves nothing", () => {
  const medians = axisMedians([
    answer([9, 2, 7, 3, 8, 5]),
    answer([8, 3, 1, 4, 8, 6]),
    answer([2, 10, 7, 9, 1, 10]),
  ]);
  assert.deepEqual(medians, {
    palette: 8,
    focalHierarchy: 3,
    negativeSpace: 7,
    readability: 4,
    atmosphere: 8,
    lighting: 6,
  });
});

await test("a room passes only when every axis median reaches the pass score", () => {
  const passing = answer([7, 8, 9, 10, 7, 7]);
  assert.equal(config.visualPassScore, 7);
  assert.equal(reachesPassScore(passing), true);
  assert.equal(reachesPassScore({ ...passing, lighting: 6 }), false);
  assert.equal(reachesPassScore({ ...passing, palette: 1 }), false);
});
