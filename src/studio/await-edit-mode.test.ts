import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitEditMode } from "./await-edit-mode.ts";
import { FakeStudioConnection } from "./fake-studio-connection.ts";

const studios = [{ id: "studio-1", name: "Place" }];
const state = (mode: string) => ({
  content: [
    {
      type: "text" as const,
      text: `- Current Studio Mode: ${mode}\n- Available DataModels: ${mode}`,
    },
  ],
});

await test("returns the studio id at once in Edit mode", async () => {
  const connection = new FakeStudioConnection(studios, { get_studio_state: () => state("Edit") });
  assert.equal(await awaitEditMode(connection), "studio-1");
  assert.equal(connection.requests.length, 1);
  assert.equal(connection.requests[0]?.studioId, "studio-1");
});

await test("polls while a playtest shuts down, then returns", async () => {
  const modes = ["Play", "Play", "Edit"];
  const connection = new FakeStudioConnection(studios, {
    get_studio_state: () => state(modes.shift() ?? "Edit"),
  });
  await awaitEditMode(connection, { pollIntervalMs: 1 });
  assert.equal(connection.requests.length, 3);
});

await test("times out naming the last reported mode", async () => {
  const connection = new FakeStudioConnection(studios, { get_studio_state: () => state("Play") });
  await assert.rejects(
    awaitEditMode(connection, { timeoutMs: 20, pollIntervalMs: 5 }),
    /did not reach Edit mode within 20 ms \(last reported: Play\)/,
  );
});

await test("an error result keeps polling and then times out with its text", async () => {
  const connection = new FakeStudioConnection(studios, {
    get_studio_state: () => ({ content: [{ type: "text" as const, text: "busy" }], isError: true }),
  });
  await assert.rejects(
    awaitEditMode(connection, { timeoutMs: 20, pollIntervalMs: 5 }),
    /last reported: error: busy/,
  );
});
