import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { createServer, resources, tools } from "./main.ts";

const toolsListByteBudget = 150_000;

async function connect(studios: { id: string; name: string }[]): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const serverInfo = { name: "roblox-kit-contract", version: "0.0.0" };
  const studio = new FakeStudioConnection(studios);
  await createServer({ serverInfo, studio, tools, resources }).connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

await test("every tool has a unique name, a title, a description and both schemas", () => {
  const names = tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of tools) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/, tool.name);
    assert.ok(tool.title.length > 0, `${tool.name} title`);
    assert.ok(tool.description.length > 0, `${tool.name} description`);
    assert.ok(Object.keys(tool.outputSchema.shape).length > 0, `${tool.name} output`);
  }
});

await test("every tool states readOnlyHint and openWorldHint, and tools/list serves them with both schemas", async () => {
  const client = await connect([]);
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    tools.map((tool) => tool.name),
  );
  for (const [index, served] of listed.tools.entries()) {
    const tool = tools[index];
    assert.ok(tool);
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean", `${tool.name} readOnlyHint`);
    assert.equal(typeof tool.annotations.openWorldHint, "boolean", `${tool.name} openWorldHint`);
    assert.deepEqual(served.annotations, tool.annotations, tool.name);
    assert.equal(served.inputSchema.type, "object", tool.name);
    assert.equal(served.outputSchema?.type, "object", tool.name);
  }
  await client.close();
});

await test("input that fails a tool's schema gives an isError result", async () => {
  const client = await connect([{ id: "s1", name: "Place" }]);
  for (const tool of tools) {
    const result = await client.callTool({
      name: tool.name,
      arguments: { notAnArgument: true },
    });
    assert.equal(result.isError, true, tool.name);
  }
  await client.close();
});

await test("a handler that throws gives an isError result with a message", async () => {
  const client = await connect([]);
  const result = await client.callTool({ name: "remove_map", arguments: {} });
  assert.equal(result.isError, true);
  const [first] = result.content;
  assert.ok(first?.type === "text" && first.text.length > 0);
  await client.close();
});

await test("the serialized tools/list result stays under its byte budget", async () => {
  const client = await connect([]);
  const bytes = Buffer.byteLength(JSON.stringify(await client.listTools()));
  assert.ok(bytes < toolsListByteBudget, `tools/list is ${String(bytes)} bytes`);
  await client.close();
});

await test("measure_capture is served read-only after analyze_image", async () => {
  const client = await connect([]);
  const listed = (await client.listTools()).tools.map((tool) => tool.name);
  assert.equal(listed.indexOf("measure_capture"), listed.indexOf("analyze_image") + 1);
  const served = tools.find((tool) => tool.name === "measure_capture");
  assert.equal(served?.annotations.readOnlyHint, true);
  await client.close();
});

await test("compare_images is served after measure_capture and is not read-only", async () => {
  const client = await connect([]);
  const listed = (await client.listTools()).tools.map((tool) => tool.name);
  assert.equal(listed.indexOf("compare_images"), listed.indexOf("measure_capture") + 1);
  const served = tools.find((tool) => tool.name === "compare_images");
  assert.equal(served?.annotations.readOnlyHint, false);
  await client.close();
});
