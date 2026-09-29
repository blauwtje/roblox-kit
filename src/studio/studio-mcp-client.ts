import {
  Client,
  type CallToolResult,
  type Implementation,
  type Transport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import type { StudioConnection, StudioInfo, StudioToolRequest } from "./studio-connection.ts";
import { studioMcpCommand } from "./studio-mcp-command.ts";

/** MCP revision the StudioMCP connection is pinned to (research P3). */
const pinnedProtocolVersion = "2026-07-28";
const listStudiosToolName = "list_roblox_studios";

/** `list_roblox_studios` answers with JSON text; entries carry an `id` and a `name` (tool description). */
const listStudiosSchema = z.object({
  studios: z.array(z.object({ id: z.string(), name: z.string() })),
});

export interface StudioMcpClientOptions {
  clientInfo: Implementation;
  /** Upper bound of the connect handshake and of every tool call. */
  timeoutMs: number;
  /** Spawns a fresh transport per connection; defaults to Studio's own StudioMCP process. */
  createTransport?: () => Transport;
}

function spawnStudioMcp(): Transport {
  const target = studioMcpCommand(process.platform, process.env);
  return new StdioClientTransport({
    command: target.command,
    args: target.args,
    stderr: "inherit",
  });
}

/**
 * StudioConnection over one SDK client. The StudioMCP process starts on the first call. When it
 * exits, the next call starts a new one; a call in flight when it exits fails and is not replayed,
 * because `execute_luau` is not idempotent.
 */
export class StudioMcpClient implements StudioConnection {
  readonly #options: StudioMcpClientOptions;
  #session: Promise<Client> | undefined;

  constructor(options: StudioMcpClientOptions) {
    this.#options = options;
  }

  async listStudios(): Promise<StudioInfo[]> {
    const result = await this.#callUpstream(listStudiosToolName, {});
    const text = result.content.find((block) => block.type === "text");
    if (result.isError || text === undefined) {
      throw new Error(`StudioMCP could not list Studios: ${text?.text ?? "empty result"}`);
    }
    const parsed = listStudiosSchema.safeParse(JSON.parse(text.text));
    if (!parsed.success) {
      throw new Error(`StudioMCP returned an unexpected Studio list: ${text.text}`);
    }
    return parsed.data.studios;
  }

  callTool(request: StudioToolRequest): Promise<CallToolResult> {
    return this.#callUpstream(request.name, { ...request.arguments, studio_id: request.studioId });
  }

  async close(): Promise<void> {
    const session = this.#session;
    this.#session = undefined;
    await (await session)?.close();
  }

  async #callUpstream(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = await this.#connectedClient();
    return client.callTool({ name, arguments: args }, { timeout: this.#options.timeoutMs });
  }

  #connectedClient(): Promise<Client> {
    this.#session ??= this.#connect();
    return this.#session;
  }

  async #connect(): Promise<Client> {
    const client = new Client(this.#options.clientInfo, {
      versionNegotiation: { mode: { pin: pinnedProtocolVersion } },
    });
    const forgetSession = (): void => {
      this.#session = undefined;
    };
    client.onclose = forgetSession;
    try {
      const createTransport = this.#options.createTransport ?? spawnStudioMcp;
      await client.connect(createTransport(), { timeout: this.#options.timeoutMs });
    } catch (error) {
      forgetSession();
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not connect to Roblox Studio's MCP server (${reason}). Open Studio and turn on Assistant > Manage MCP Servers > Enable Studio as MCP server.`,
        { cause: error },
      );
    }
    return client;
  }
}
