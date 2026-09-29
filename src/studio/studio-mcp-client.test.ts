import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { FakeStudioConnection } from "./fake-studio-connection.ts";
import { selectStudio } from "./studio-connection.ts";
import { StudioMcpClient } from "./studio-mcp-client.ts";

const clientInfo = { name: "roblox-kit-test", version: "0.0.0" };
const studioList = { studios: [{ id: "studio-a", name: "Place A" }] };

/** A stand-in StudioMCP: an SDK server behind a linked in-memory transport, one per connection. */
function fakeStudioMcpServers() {
  const servers: StdioServerHandle[] = [];
  const receivedStudioIds: string[] = [];
  const createTransport = () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    servers.push(
      serveStdio(
        () => {
          const server = new McpServer({ name: "RobloxStudio", version: "1.0.0" });
          server.registerTool("list_roblox_studios", {}, () => ({
            content: [{ type: "text", text: JSON.stringify(studioList) }],
          }));
          server.registerTool(
            "execute_luau",
            { inputSchema: z.object({ code: z.string(), studio_id: z.string() }) },
            ({ code, studio_id }) => {
              receivedStudioIds.push(studio_id);
              return { content: [{ type: "text", text: `ran ${code}` }] };
            },
          );
          return server;
        },
        { transport: serverSide },
      ),
    );
    return clientSide;
  };
  return { servers, receivedStudioIds, createTransport };
}

await test("connects lazily, lists Studios and adds studio_id to a tool call", async () => {
  const fake = fakeStudioMcpServers();
  const client = new StudioMcpClient({
    clientInfo,
    timeoutMs: 5000,
    createTransport: fake.createTransport,
  });
  assert.equal(fake.servers.length, 0);

  assert.deepEqual(await client.listStudios(), studioList.studios);
  const result = await client.callTool({
    name: "execute_luau",
    studioId: "studio-a",
    arguments: { code: "return 1" },
  });

  assert.deepEqual(result.content, [{ type: "text", text: "ran return 1" }]);
  assert.deepEqual(fake.receivedStudioIds, ["studio-a"]);
  assert.equal(fake.servers.length, 1);
  await client.close();
});

await test("starts a new StudioMCP for the next call after the first one exits", async () => {
  const fake = fakeStudioMcpServers();
  const client = new StudioMcpClient({
    clientInfo,
    timeoutMs: 5000,
    createTransport: fake.createTransport,
  });
  await client.listStudios();

  await fake.servers[0]?.close();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(await client.listStudios(), studioList.studios);
  assert.equal(fake.servers.length, 2);
  await client.close();
});

await test("reports how to enable the Studio MCP server when the connection fails", async () => {
  const client = new StudioMcpClient({
    clientInfo,
    timeoutMs: 5000,
    createTransport: () => {
      throw new Error("spawn failed");
    },
  });
  await assert.rejects(client.listStudios(), /spawn failed.*Enable Studio as MCP server/s);
});

await test("selectStudio uses the only Studio, or the requested id", async () => {
  const one = new FakeStudioConnection([{ id: "a", name: "Place A" }]);
  assert.equal(await selectStudio(one, undefined), "a");
  assert.equal(await selectStudio(one, "a"), "a");
});

await test("selectStudio errors with the list when the choice is ambiguous or unknown", async () => {
  const two = new FakeStudioConnection([
    { id: "a", name: "Place A" },
    { id: "b", name: "Place B" },
  ]);
  await assert.rejects(selectStudio(two, undefined), /Several.*Place A.*studioId: a.*Place B/s);
  await assert.rejects(selectStudio(two, "c"), /"c".*Place A.*Place B/s);
  await assert.rejects(
    selectStudio(new FakeStudioConnection([]), undefined),
    /No Roblox Studio is connected/,
  );
});
