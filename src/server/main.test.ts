import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { selectStudio } from "../studio/studio-connection.ts";
import { createServer, serveOverStdio, tools } from "./main.ts";
import type { ToolDefinition } from "./tool-definition.ts";
import { toolResult } from "./tool-result.ts";

const serverInfo = { name: "roblox-kit-test", version: "0.0.0" };
const studio = new FakeStudioConnection([{ id: "s1", name: "Place" }]);

const echoInput = z.strictObject({ text: z.string() });
const echoOutput = z.strictObject({ text: z.string(), studioId: z.string() });

const echoTool: ToolDefinition<typeof echoInput, typeof echoOutput> = {
  name: "echo",
  title: "Echo",
  description: "Returns its text and the selected Studio id.",
  inputSchema: echoInput,
  outputSchema: echoOutput,
  annotations: { readOnlyHint: true },
  async handler(input, context) {
    const studioId = await selectStudio(context.studio, undefined);
    return toolResult({ text: input.text, studioId });
  },
};

const failInput = z.strictObject({});
const failTool: ToolDefinition<typeof failInput, typeof failInput> = {
  name: "fail",
  title: "Fail",
  description: "Always throws.",
  inputSchema: failInput,
  outputSchema: failInput,
  annotations: { readOnlyHint: true },
  handler() {
    return Promise.reject(new Error("Nothing to fail on. Pass a valid mapId."));
  },
};

async function connectClient(
  toolList: readonly ToolDefinition[],
  serve: "createServer" | "serveOverStdio",
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const options = { serverInfo, studio, tools: toolList };
  const client = new Client({ name: "test-client", version: "0.0.0" });
  if (serve === "createServer") {
    await createServer(options).connect(serverTransport);
    await client.connect(clientTransport);
    return { client, close: () => client.close() };
  }
  const handle = serveOverStdio(options, serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await handle.close();
    },
  };
}

await test("the shipped registry starts as an array", () => {
  assert.ok(Array.isArray(tools));
});

await test("tools/list follows array order and exposes schemas and annotations", async () => {
  const { client, close } = await connectClient([failTool, echoTool], "createServer");
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ["fail", "echo"],
  );
  const echo = listed.tools[1];
  assert.ok(echo);
  assert.equal(echo.title, "Echo");
  assert.deepEqual(echo.annotations, { readOnlyHint: true });
  assert.ok(echo.inputSchema.properties?.["text"]);
  assert.ok(echo.outputSchema);
  await close();
});

await test("a call returns structured content and the same JSON as text, with the Studio context", async () => {
  const { client, close } = await connectClient([echoTool], "createServer");
  const result = await client.callTool({ name: "echo", arguments: { text: "hi" } });
  assert.deepEqual(result.structuredContent, { text: "hi", studioId: "s1" });
  assert.deepEqual(result.content, [{ type: "text", text: '{"text":"hi","studioId":"s1"}' }]);
  await close();
});

await test("a throwing handler becomes an isError result with its message", async () => {
  const { client, close } = await connectClient([failTool], "createServer");
  const result = await client.callTool({ name: "fail", arguments: {} });
  assert.equal(result.isError, true);
  assert.deepEqual(result.content, [
    { type: "text", text: "Nothing to fail on. Pass a valid mapId." },
  ]);
  await close();
});

await test("serveOverStdio serves the same tools over the given transport", async () => {
  const { client, close } = await connectClient([echoTool], "serveOverStdio");
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ["echo"],
  );
  const result = await client.callTool({ name: "echo", arguments: { text: "over" } });
  assert.deepEqual(result.structuredContent, { text: "over", studioId: "s1" });
  await close();
});

const mainPath = fileURLToPath(new URL("./main.ts", import.meta.url));

/** Spawns main.ts as its own process, with no Studio running, and connects over its real stdio. */
async function connectToSpawnedServer(
  versionNegotiation: ConstructorParameters<typeof Client>[1],
): Promise<Client> {
  const client = new Client({ name: "test-client", version: "0.0.0" }, versionNegotiation);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mainPath],
    stderr: "inherit",
  });
  await client.connect(transport, { timeout: 15_000 });
  return client;
}

await test("a spawned server answers 2026-07-28 discovery and lists tools without Studio", async () => {
  const client = await connectToSpawnedServer({
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  });
  assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");
  assert.equal(client.getServerVersion()?.name, "roblox-kit");
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    tools.map((tool) => tool.name),
  );
  await client.close();
});

await test("a spawned server also serves a client that opens with initialize", async () => {
  const client = await connectToSpawnedServer(undefined);
  assert.equal(client.getServerVersion()?.name, "roblox-kit");
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    tools.map((tool) => tool.name),
  );
  await client.close();
});
