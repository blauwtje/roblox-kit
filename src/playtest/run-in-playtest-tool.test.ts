import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { config } from "../config.ts";
import { FakeStudioConnection, type FakeToolHandler } from "../studio/fake-studio-connection.ts";
import { createRunInPlaytestTool } from "./run-in-playtest-tool.ts";

const studios = [{ id: "studio-a", name: "Place A" }];

function luauText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function callTool(connection: FakeStudioConnection, input: Record<string, unknown>) {
  const tool = createRunInPlaytestTool();
  return tool.handler(tool.inputSchema.parse(input), { studio: connection });
}

function structured(result: CallToolResult): Record<string, unknown> {
  const { structuredContent } = result;
  assert.ok(structuredContent !== undefined && structuredContent !== null);
  return { ...structuredContent };
}

function connectionAnswering(answer: FakeToolHandler): FakeStudioConnection {
  return new FakeStudioConnection(studios, { execute_luau: answer });
}

await test("returns the value the code returned and runs the probe in the Server datamodel", async () => {
  const connection = connectionAnswering(() =>
    luauText(JSON.stringify({ status: "finished", result: { ok: true, value: { count: 3 } } })),
  );
  const result = await callTool(connection, { code: "return { count = 3 }", timeoutSeconds: 5 });
  assert.deepEqual(structured(result)["value"], { count: 3 });
  assert.equal(typeof structured(result)["durationMs"], "number");
  assert.equal(connection.requests.length, 1);
  const request = connection.requests[0];
  assert.ok(request !== undefined);
  assert.equal(request.name, "execute_luau");
  assert.equal(request.studioId, "studio-a");
  assert.equal(request.arguments["datamodel_type"], "Server");
  const code = request.arguments["code"];
  assert.ok(typeof code === "string");
  assert.ok(code.includes("return { count = 3 }"), "the caller's code is in the sent probe source");
  assert.ok(code.includes('\\"timeoutSeconds\\":5') || code.includes('"timeoutSeconds":5'));
});

await test("defaults the timeout and reports null when the code returns nothing", async () => {
  const connection = connectionAnswering(() =>
    luauText(JSON.stringify({ status: "finished", result: { ok: true } })),
  );
  const result = await callTool(connection, { code: "local x = 1" });
  assert.equal(structured(result)["value"], null);
  const code = connection.requests[0]?.arguments["code"];
  assert.ok(
    typeof code === "string" &&
      code.includes(`"timeoutSeconds":${String(config.defaultRunInPlaytestTimeoutSeconds)}`),
  );
});

await test("a throw in the code fails the call with its message", async () => {
  const connection = connectionAnswering(() =>
    luauText(JSON.stringify({ status: "finished", result: { ok: false, error: "boom" } })),
  );
  await assert.rejects(callTool(connection, { code: "error('boom')" }), /The code threw: boom/);
});

await test("a timeout fails the call and names the likely causes", async () => {
  const connection = connectionAnswering(() => luauText(JSON.stringify({ status: "timed-out" })));
  await assert.rejects(
    callTool(connection, { code: "while true do end", timeoutSeconds: 2 }),
    /did not return within 2 s.*syntax error/s,
  );
});

await test("a missing playtest surfaces Studio's error", async () => {
  const connection = connectionAnswering(() => ({
    ...luauText("No playtest is running in this server."),
    isError: true,
  }));
  await assert.rejects(callTool(connection, { code: "return 1" }), /No playtest is running/);
});

await test("rejects an empty code and a timeout outside the bounds", () => {
  const { inputSchema } = createRunInPlaytestTool();
  assert.throws(() => inputSchema.parse({ code: "" }));
  assert.throws(() => inputSchema.parse({ code: "return 1", timeoutSeconds: 0 }));
  assert.throws(() =>
    inputSchema.parse({
      code: "return 1",
      timeoutSeconds: config.maxRunInPlaytestTimeoutSeconds + 1,
    }),
  );
  inputSchema.parse({
    code: "return 1",
    timeoutSeconds: config.maxRunInPlaytestTimeoutSeconds,
  });
});
