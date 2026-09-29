import type { CallToolResult } from "@modelcontextprotocol/client";
import type { StudioConnection, StudioInfo, StudioToolRequest } from "./studio-connection.ts";

export type FakeToolHandler = (
  request: StudioToolRequest,
) => CallToolResult | Promise<CallToolResult>;

/** In-memory StudioConnection for tests: fixed Studios, per-tool handlers, recorded requests. */
export class FakeStudioConnection implements StudioConnection {
  readonly requests: StudioToolRequest[] = [];
  readonly #studios: StudioInfo[];
  readonly #handlers: Record<string, FakeToolHandler>;

  constructor(studios: StudioInfo[], handlers: Record<string, FakeToolHandler> = {}) {
    this.#studios = studios;
    this.#handlers = handlers;
  }

  listStudios(): Promise<StudioInfo[]> {
    return Promise.resolve(this.#studios);
  }

  async callTool(request: StudioToolRequest): Promise<CallToolResult> {
    this.requests.push(request);
    const handler = this.#handlers[request.name];
    if (handler === undefined) {
      return { content: [{ type: "text", text: `Unknown tool ${request.name}` }], isError: true };
    }
    return handler(request);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
