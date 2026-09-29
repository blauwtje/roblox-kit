import assert from "node:assert/strict";
import { test } from "node:test";
import { toolErrorResult } from "./tool-error.ts";
import { toolResult } from "./tool-result.ts";

await test("toolResult returns the structured value and the same JSON as text", () => {
  const result = toolResult({ mapId: "arena", partCount: 3 });
  assert.deepEqual(result.structuredContent, { mapId: "arena", partCount: 3 });
  assert.deepEqual(result.content, [{ type: "text", text: '{"mapId":"arena","partCount":3}' }]);
  assert.equal(result.isError, undefined);
});

await test("toolResult appends extra content after the text block", () => {
  const link = {
    type: "resource_link",
    uri: "roblox-kit://check-reports/r1",
    name: "r1",
  } as const;
  const result = toolResult({ ok: true }, [link]);
  assert.deepEqual(result.content, [{ type: "text", text: '{"ok":true}' }, link]);
});

await test("toolErrorResult carries an Error message as an isError result", () => {
  const result = toolErrorResult(new Error("No Roblox Studio is connected."));
  assert.equal(result.isError, true);
  assert.deepEqual(result.content, [{ type: "text", text: "No Roblox Studio is connected." }]);
  assert.equal(result.structuredContent, undefined);
});

await test("toolErrorResult stringifies a thrown non-Error", () => {
  const result = toolErrorResult("boom");
  assert.equal(result.isError, true);
  assert.deepEqual(result.content, [{ type: "text", text: "boom" }]);
});
