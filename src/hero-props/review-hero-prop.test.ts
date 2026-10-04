import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { config } from "../config.ts";
import { loadPresets } from "../style/load-preset.ts";
import {
  heroPropAxes,
  heroPropBrief,
  recordRound,
  reviewFromAnswer,
  type HeroPropAnswer,
} from "./review-hero-prop.ts";

function answerScoring(scores: Record<(typeof heroPropAxes)[number], number>): HeroPropAnswer {
  const answer = {} as HeroPropAnswer;
  for (const axis of heroPropAxes) {
    answer[axis] = { evidence: `${axis} note`, score: scores[axis] };
  }
  return answer;
}

const passing = config.visualPassScore;

await test("passes when every axis reaches the pass score and keeps a note per axis", () => {
  const review = reviewFromAnswer(
    "abc",
    answerScoring({ silhouette: passing, proportions: 9, style: 10, roleSeparation: passing }),
  );
  assert.equal(review.passed, true);
  assert.equal(review.hash, "abc");
  assert.deepEqual(review.axes.silhouette, { score: passing, note: "silhouette note" });
});

await test("fails when one axis is below the pass score", () => {
  const review = reviewFromAnswer(
    "abc",
    answerScoring({ silhouette: 9, proportions: 9, style: passing - 1, roleSeparation: 9 }),
  );
  assert.equal(review.passed, false);
});

await test("fills the brief from the recipe and the render names", async () => {
  const preset = (await loadPresets()).get("train-station");
  const recipe = preset?.heroProps?.["train-car"];
  assert.ok(preset !== undefined && recipe !== undefined);
  const promptText = await readFile(
    new URL("../../skills/visual-judge/hero-prop-prompt.md", import.meta.url),
    "utf8",
  );
  const brief = heroPropBrief(promptText, "train-car", recipe, preset.surfaces, [
    "render-1.png",
    "render-2.png",
    "render-3.png",
  ]);
  assert.match(brief, /^You are a low-poly 3D art reviewer/);
  assert.match(brief, /a `train-car`:/);
  assert.match(brief, /render-3\.png/);
  assert.match(brief, /- trim: #[0-9a-fA-F]{6}, \d+ parts/);
  assert.doesNotMatch(brief, /<[a-z ]+>/);
});

await test("counts each distinct hash once and refuses one past the round limit", async () => {
  const folder = await mkdtemp(`${tmpdir()}/hero-prop-rounds-`);
  try {
    const roundsFile = new URL("kind/rounds.json", `${pathToFileURL(folder).href}/`);
    const hashes = Array.from(
      { length: config.maxHeroPropRounds },
      (_, index) => `hash-${String(index)}`,
    );
    for (const hash of hashes) await recordRound(roundsFile, hash);
    for (const hash of hashes) await recordRound(roundsFile, hash);
    await assert.rejects(recordRound(roundsFile, "one-too-many"), /Refusing a round/);
    assert.deepEqual(JSON.parse(await readFile(roundsFile, "utf8")), hashes);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
