import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { config } from "../config.ts";
import { FakeStudioConnection, type FakeToolHandler } from "../studio/fake-studio-connection.ts";
import { removeMapTool } from "./remove-map-tool.ts";

const studios = [{ id: "studio-a", name: "Place A" }];

function luauText(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError };
}

function callTool(connection: FakeStudioConnection, input: Record<string, unknown>) {
  return removeMapTool.handler(removeMapTool.inputSchema.parse(input), { studio: connection });
}

function connectionAnswering(...answers: FakeToolHandler[]): FakeStudioConnection {
  let call = 0;
  return new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const answer = answers[call];
      call += 1;
      assert.ok(answer !== undefined, "an unexpected extra execute_luau call");
      return answer(request);
    },
  });
}

function codeOf(connection: FakeStudioConnection, index: number): string {
  return String(connection.requests[index]?.arguments["code"]);
}

await test("restores lighting first, then removes the map, passing the mapId as data", async () => {
  const connection = connectionAnswering(
    () => luauText({ restored: "original", remainingStyledMaps: [] }),
    () => luauText({ removed: true }),
  );
  const result = await callTool(connection, { mapId: "town" });
  assert.deepEqual(result.structuredContent, {
    mapId: "town",
    lighting: { restored: "original", remainingStyledMaps: [] },
    warnings: [],
  });
  assert.equal(connection.requests.length, 2);
  assert.ok(codeOf(connection, 0).includes('"removing":true'));
  assert.ok(codeOf(connection, 1).includes('"mapId":"town"'));
  assert.ok(
    codeOf(connection, 1).includes("RobloxKitTerrainFills"),
    "the Luau file is remove-map.luau",
  );
  assert.equal(connection.requests[1]?.arguments["datamodel_type"], "Edit");
});

await test("warns and keeps lighting while another styled map remains", async () => {
  const connection = connectionAnswering(
    () => luauText({ restored: null, remainingStyledMaps: ["b", "c"] }),
    () => luauText({ removed: true }),
  );
  const result = await callTool(connection, { mapId: "a" });
  const warnings = (result.structuredContent as { warnings: string[] }).warnings;
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0]?.includes("b, c"));
});

await test("says so when an older place falls back to the map's own snapshot", async () => {
  const connection = connectionAnswering(
    () => luauText({ restored: "map", remainingStyledMaps: [] }),
    () => luauText({ removed: true }),
  );
  const result = await callTool(connection, { mapId: "a" });
  const structured = result.structuredContent as { warnings: string[] };
  assert.equal(structured.warnings.length, 1);
  assert.ok(structured.warnings[0]?.includes(config.mapsFolderName));
});

await test("a missing map fails before any removal runs", async () => {
  const connection = connectionAnswering(() =>
    luauText(
      `Map "ghost" is not under Workspace.${config.mapsFolderName}; build it before applying lighting.`,
      true,
    ),
  );
  await assert.rejects(callTool(connection, { mapId: "ghost" }), /not under Workspace/);
  assert.equal(connection.requests.length, 1, "remove-map.luau never ran");
});

await test("a mapId that looks like code stays data and fails as not found", async () => {
  const hostile = 'x"); workspace:ClearAllChildren() --';
  const connection = connectionAnswering(() =>
    luauText(
      `Map "${hostile}" is not under Workspace.${config.mapsFolderName}; build it before applying lighting.`,
      true,
    ),
  );
  await assert.rejects(callTool(connection, { mapId: hostile }), /not under Workspace/);
  assert.equal(connection.requests.length, 1);
  const code = codeOf(connection, 0);
  // The mapId travels inside the JSON arguments literal, escaped as a JSON string, never as code of its own.
  assert.ok(code.includes(JSON.stringify(hostile)));
  assert.ok(
    !code.split("\n").some((line) => line.trimStart().startsWith("workspace:ClearAllChildren")),
  );
});
