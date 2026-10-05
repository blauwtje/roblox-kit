import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { reviewerCommand } from "./ask-headless-reviewer.ts";

await test("with no environment the claude backend passes no model or effort", () => {
  const { command, args } = reviewerCommand({}, "{}");
  assert.equal(command, "claude");
  assert.equal(args.includes("--model"), false);
  assert.equal(args.includes("--effort"), false);
  assert.deepEqual(args.slice(-2), ["--json-schema", "{}"]);
});

await test("model and effort are passed only when their variables are set", () => {
  const { args } = reviewerCommand(
    { [config.reviewerModelEnv]: "some-model", [config.reviewerEffortEnv]: "high" },
    "{}",
  );
  assert.equal(args[args.indexOf("--model") + 1], "some-model");
  assert.equal(args[args.indexOf("--effort") + 1], "high");
  const modelOnly = reviewerCommand({ [config.reviewerModelEnv]: "some-model" }, "{}").args;
  assert.equal(modelOnly.includes("--effort"), false);
});

await test("an empty model variable counts as unset", () => {
  const { args } = reviewerCommand({ [config.reviewerModelEnv]: "" }, "{}");
  assert.equal(args.includes("--model"), false);
});

await test("the backend override selects a backend and an unknown one throws", () => {
  assert.equal(reviewerCommand({ [config.reviewerBackendEnv]: "claude" }, "{}").command, "claude");
  assert.throws(
    () => reviewerCommand({ [config.reviewerBackendEnv]: "nope" }, "{}"),
    /Unknown reviewer backend "nope"/,
  );
  assert.throws(
    () => reviewerCommand({ [config.reviewerBackendEnv]: "toString" }, "{}"),
    /Unknown reviewer backend/,
  );
});
