import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRoughPrompt, type RoughPromptFixture } from "./rough-prompt-check.ts";

const fixture: RoughPromptFixture = {
  prompt: "a cozy town with a Train Station and moving signs",
  names: ["Train Station"],
  switches: ["signage"],
};
const rooms = [{ name: "train-station" }];

await test("passes when the name is kept after normalizing and only asked switches are on", () => {
  const result = checkRoughPrompt(fixture, {
    buildMapInput: { rooms, signage: true, clutter: false },
    questions: ["Which size?"],
  });
  assert.deepEqual(result, { pass: true, problems: [] });
});

await test("fails when a stated name is dropped", () => {
  const result = checkRoughPrompt(fixture, {
    buildMapInput: { rooms: [{ name: "lobby" }] },
    questions: [],
  });
  assert.equal(result.pass, false);
  assert.match(result.problems[0] ?? "", /Train Station/);
});

await test("fails when a switch is on without being asked", () => {
  const result = checkRoughPrompt(fixture, {
    buildMapInput: { rooms, npcs: { density: 0.5 }, motion: true },
    questions: [],
  });
  assert.equal(result.pass, false);
  assert.equal(result.problems.length, 2);
});

await test("fails when the reply asks two questions", () => {
  const result = checkRoughPrompt(fixture, {
    buildMapInput: { rooms },
    questions: ["a?", "b?"],
  });
  assert.equal(result.pass, false);
});
