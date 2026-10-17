import { readFileSync } from "node:fs";
import { z } from "zod";
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
import { checkReportResource, createCheckMapTool } from "../map/check-map-tool.ts";
import { CheckReportStore } from "../map/check-report-store.ts";
import { createJudgeRoundTool } from "../eval/judge-round-tool.ts";
import { removeMapTool } from "../map/remove-map-tool.ts";
import { createRunInPlaytestTool } from "../playtest/run-in-playtest-tool.ts";
import { createRunPlaytestTool } from "../playtest/run-playtest-tool.ts";
import type { StudioConnection } from "../studio/studio-connection.ts";
import { StudioMcpClient } from "../studio/studio-mcp-client.ts";
import type { ResourceDefinition, ToolContext, ToolDefinition } from "./tool-definition.ts";
import { toolErrorResult } from "./tool-error.ts";

/** The `version` of `.claude-plugin/plugin.json`, read once at startup: the one source of the server version. */
export const pluginVersion = z
  .object({ version: z.string() })
  .parse(
    JSON.parse(readFileSync(new URL("../../.claude-plugin/plugin.json", import.meta.url), "utf8")),
  ).version;

export interface ToolDependencies {
  projectDir: string | undefined;
}

/** The server's tools in `tools/list` order and the resources they supply, built from one store of check reports. */
export function createTools(deps: ToolDependencies): {
  tools: readonly ToolDefinition[];
  resources: readonly ResourceDefinition[];
} {
  const checkReports = new CheckReportStore();
  return {
    tools: [
      buildMapTool,
      createCheckMapTool(checkReports),
      captureZonesTool,
      createRunPlaytestTool(),
      removeMapTool,
      createRunInPlaytestTool(),
      createJudgeRoundTool(deps.projectDir),
    ],
    resources: [checkReportResource(checkReports)],
  };
}

export const { tools, resources } = createTools({ projectDir: process.env["PROJECT_DIR"] });

export interface ServerOptions {
  serverInfo: Implementation;
  studio: StudioConnection;
  tools: readonly ToolDefinition[];
  resources?: readonly ResourceDefinition[];
  checkReports?: CheckReportStore;
}

function registerResource(server: McpServer, resource: ResourceDefinition): void {
  server.registerResource(
    resource.name,
    new ResourceTemplate(resource.uriTemplate, { list: undefined }),
    { title: resource.title, description: resource.description, mimeType: "application/json" },
    (uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: resource.read(uri.href, variables),
        },
      ],
    }),
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
      async (input, callContext) => {
        const progressToken = callContext.mcpReq._meta?.progressToken;
        const reportProgress: NonNullable<ToolContext["reportProgress"]> = async (
          progress,
          total,
          message,
        ) => {
          if (progressToken === undefined) {
            return;
          }
          await callContext.mcpReq.notify({
            method: "notifications/progress",
            params: { progressToken, progress, total, message },
          });
        };
        try {
          return await tool.handler(input, { studio: options.studio, reportProgress });
        } catch (error) {
          return toolErrorResult(error);
        }
      },
    );
  }
  const shorthand =
    options.checkReports === undefined ? [] : [checkReportResource(options.checkReports)];
  for (const resource of [...(options.resources ?? []), ...shorthand]) {
    registerResource(server, resource);
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
  const serverInfo = { name: config.serverName, version: pluginVersion };
  const studio = new StudioMcpClient({
    clientInfo: serverInfo,
    timeoutMs: config.upstreamTimeoutMs,
  });
  serveOverStdio({ serverInfo, studio, tools, resources });
  process.stdin.once("end", () => {
    studio.close().catch((error: unknown) => {
      console.error(`roblox-kit: could not close the Studio connection: ${String(error)}`);
    });
  });
}

if (import.meta.main) {
  runServer();
}
