import { McpServer, type Implementation, type Transport } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { config } from "../config.ts";
import type { StudioConnection } from "../studio/studio-connection.ts";
import { StudioMcpClient } from "../studio/studio-mcp-client.ts";
import type { ToolDefinition } from "./tool-definition.ts";
import { toolErrorResult } from "./tool-error.ts";

/** The server's tools in `tools/list` order; each tool module adds its definition here. */
export const tools: readonly ToolDefinition[] = [];

export interface ServerOptions {
  serverInfo: Implementation;
  studio: StudioConnection;
  tools: readonly ToolDefinition[];
}

/** Builds a server with every tool registered in array order. */
export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer(options.serverInfo, { capabilities: { tools: {} } });
  for (const tool of options.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      async (input) => {
        try {
          return await tool.handler(input, { studio: options.studio });
        } catch (error) {
          return toolErrorResult(error);
        }
      },
    );
  }
  return server;
}

/**
 * Serves the tools over the process's stdin and stdout, which carry the protocol: log to stderr
 * only. `transport` replaces stdio in tests. The factory runs once per connection and once per
 * discarded discovery probe, so it only builds the server; the Studio connection is shared and
 * starts on its first call.
 */
export function serveOverStdio(options: ServerOptions, transport?: Transport): StdioServerHandle {
  return serveStdio(() => createServer(options), {
    transport,
    onerror: (error) => {
      console.error(`roblox-kit: ${error.message}`);
    },
  });
}

/** Runs the server on this process's stdio; the StudioMCP process starts on the first tool call. */
function runServer(): void {
  const serverInfo = { name: config.serverName, version: config.serverVersion };
  const studio = new StudioMcpClient({
    clientInfo: serverInfo,
    timeoutMs: config.upstreamTimeoutMs,
  });
  serveOverStdio({ serverInfo, studio, tools });
  process.stdin.once("end", () => {
    studio.close().catch((error: unknown) => {
      console.error(`roblox-kit: could not close the Studio connection: ${String(error)}`);
    });
  });
}

if (import.meta.main) {
  runServer();
}
