import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { config } from "../config.ts";
import { runLuauBatch, runLuauFile } from "./run-luau-file.ts";

const pingSchema = z.object({ pong: z.boolean(), echo: z.string() });
const studios = [{ id: "studio-a", name: "Place A" }];

function connectionReturning(text: string, isError = false) {
  return new FakeStudioConnection(studios, {
    execute_luau: () => ({ content: [{ type: "text", text }], isError }),
  });
}

function ping(connection: FakeStudioConnection, message: string) {
  return runLuauFile({
    connection,
    studioId: "studio-a",
    fileName: "ping.luau",
    datamodelType: "Edit",
    arguments: { message },
    resultSchema: pingSchema,
  });
}

await test("sends the wrapped file with a JSON literal and returns the typed result", async () => {
  const connection = connectionReturning('{"pong":true,"echo":"hi"}');
  const result = await ping(connection, "hi");
  assert.deepEqual(result, { pong: true, echo: "hi" });
  const [request] = connection.requests;
  assert.equal(request?.name, "execute_luau");
  assert.equal(request.studioId, "studio-a");
  assert.equal(request.arguments["datamodel_type"], "Edit");
  const code = request.arguments["code"];
  assert.ok(typeof code === "string");
  assert.ok(code.startsWith("return (function(...)\n--!strict"));
  assert.ok(code.includes('JSONDecode([[{"message":"hi"}]])'));
  assert.ok(code.includes("return HttpService:JSONEncode"));
});

await test("widens the long bracket when the arguments contain a closer", async () => {
  const connection = connectionReturning('{"pong":true,"echo":"x"}');
  await ping(connection, "a]]b]=]c");
  const code = connection.requests[0]?.arguments["code"];
  assert.ok(typeof code === "string");
  assert.ok(code.includes('JSONDecode([==[{"message":"a]]b]=]c"}]==])'));
});

await test("throws Studio's message when execute_luau reports an error", async () => {
  await assert.rejects(
    ping(connectionReturning("Place is not open", true), "hi"),
    /ping\.luau failed in Studio: Place is not open/,
  );
});

await test("throws with the returned text when it is not JSON", async () => {
  await assert.rejects(
    ping(connectionReturning("pong"), "hi"),
    /did not return a JSON string. Studio returned: pong/,
  );
});

await test("throws with the schema issues when the JSON has the wrong shape", async () => {
  await assert.rejects(
    ping(connectionReturning('{"pong":"yes","echo":"hi"}'), "hi"),
    /wrong shape[\s\S]*pong/,
  );
});

await test("rejects a file that is not bundled", async () => {
  await assert.rejects(
    runLuauFile({
      connection: connectionReturning("{}"),
      studioId: "studio-a",
      fileName: "missing.luau",
      datamodelType: "Edit",
      arguments: {},
      resultSchema: z.object({}),
    }),
    /ENOENT/,
  );
});

await test("runLuauBatch sends one call and parses each entry of the returned array", async () => {
  const connection = connectionReturning('[{"pong":true,"echo":"a"},{"pong":false,"echo":"b"}]');
  const [first, second] = await runLuauBatch({
    connection,
    studioId: "studio-a",
    datamodelType: "Edit",
    entries: [
      { fileName: "ping.luau", arguments: { message: "a" }, resultSchema: pingSchema },
      { fileName: "ping.luau", arguments: { message: "b" }, resultSchema: pingSchema },
    ],
  });
  assert.deepEqual(first, { pong: true, echo: "a" });
  assert.equal(second.pong, false);
  assert.equal(connection.requests.length, 1);
  const code = connection.requests[0]?.arguments["code"];
  assert.ok(typeof code === "string");
  assert.ok(code.includes('JSONDecode([[{"message":"a"}]])'));
  assert.ok(code.includes('JSONDecode([[{"message":"b"}]])'));
  assert.ok(code.includes("results[2] = (function(...)"));
});

await test("runLuauBatch rejects when an entry has the wrong shape", async () => {
  await assert.rejects(
    runLuauBatch({
      connection: connectionReturning('[{"pong":"yes","echo":"a"}]'),
      studioId: "studio-a",
      datamodelType: "Edit",
      entries: [{ fileName: "ping.luau", arguments: {}, resultSchema: pingSchema }],
    }),
    /wrong shape[\s\S]*pong/,
  );
});

await test("a result ending in the truncation marker is an actionable error, not a parse failure", async () => {
  const truncated = `{"issues":[{"a":1}${config.executeLuauTruncationMarker}`;
  await assert.rejects(
    ping(connectionReturning(truncated), "hi"),
    /truncated it\. Narrow the request/,
  );
});

await test("inlines the shared map helpers into every file that requires them", async () => {
  for (const fileName of ["check-map.luau", "remove-map.luau", "build/shell.luau"]) {
    const connection = connectionReturning("{}");
    await runLuauFile({
      connection,
      studioId: "studio-a",
      fileName,
      datamodelType: "Edit",
      arguments: {},
      resultSchema: z.object({}),
    });
    const code = connection.requests[0]?.arguments["code"];
    assert.ok(typeof code === "string");
    assert.ok(code.includes("findMapModel = function(folderName: string, mapId: string): Model?"));
    assert.ok(!/^\s*local \w+ = require\(/m.test(code));
  }
});
