import {
  McpServer,
  ResourceTemplate,
  type Implementation,
  type Transport,
} from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { config } from "../config.ts";
import { buildMapTool } from "../map/build-map-tool.ts";
import { captureZonesTool } from "../map/capture-zones-tool.ts";
import { createCheckMapTool } from "../map/check-map-tool.ts";
import { CheckReportStore } from "../map/check-report-store.ts";
import { createRunPlaytestTool } from "../playtest/run-playtest-tool.ts";
import type { StudioConnection } from "../studio/studio-connection.ts";
import { StudioMcpClient } from "../studio/studio-mcp-client.ts";
import type { ToolDefinition } from "./tool-definition.ts";
import { toolErrorResult } from "./tool-error.ts";

/** Full check reports of this process, written by `check_map` and read through the report resource. */
const checkReports = new CheckReportStore();

/** The server's tools in `tools/list` order; each tool module adds its definition here. */
export const tools: readonly ToolDefinition[] = [
  buildMapTool,
  createCheckMapTool(checkReports),
  captureZonesTool,
  createRunPlaytestTool(),
];

export interface ServerOptions {
  serverInfo: Implementation;
  studio: StudioConnection;
  tools: readonly ToolDefinition[];
  /** When set, the server serves each stored report at `config.checkReportUriPrefix` plus its id. */
  checkReports?: CheckReportStore;
}

function registerCheckReportResource(server: McpServer, reports: CheckReportStore): void {
  server.registerResource(
    "check-report",
    new ResourceTemplate(`${config.checkReportUriPrefix}{reportId}`, { list: undefined }),
    {
      title: "Check report",
      description: "The full report of one check_map call, by reportId.",
      mimeType: "application/json",
    },
    (uri, variables) => {
      const report = reports.get(String(variables["reportId"]));
      if (report === undefined) {
        throw new Error(
          `No check report at ${uri.href}. Reports last only while the roblox-kit server runs; call check_map again for a new one.`,
        );
      }
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(report) }],
      };
    },
  );
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
  if (options.checkReports !== undefined) {
    registerCheckReportResource(server, options.checkReports);
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
  serveOverStdio({ serverInfo, studio, tools, checkReports });
  process.stdin.once("end", () => {
    studio.close().catch((error: unknown) => {
      console.error(`roblox-kit: could not close the Studio connection: ${String(error)}`);
    });
  });
}

if (import.meta.main) {
  runServer();
}
