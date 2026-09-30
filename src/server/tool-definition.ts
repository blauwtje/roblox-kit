import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { StudioConnection } from "../studio/studio-connection.ts";

/** What every tool handler receives besides its validated input. */
export interface ToolContext {
  studio: StudioConnection;
  /**
   * Sends an MCP progress notification for the running call. The registry always sets it, and it
   * does nothing when the client sent no progressToken. `total` is the number of steps. It is
   * optional only so direct handler calls in tests may omit it; make it required once they pass it.
   */
  reportProgress?(progress: number, total: number, message: string): Promise<void>;
}

/**
 * One MCP tool of this server. The registry in `main.ts` registers an ordered array of these, so
 * `tools/list` follows array order. The handler may throw; the registry turns a throw into an
 * `isError` result.
 */
export interface ToolDefinition<
  Input extends z.ZodObject = z.ZodObject,
  Output extends z.ZodObject = z.ZodObject,
> {
  name: string;
  title: string;
  description: string;
  inputSchema: Input;
  outputSchema: Output;
  annotations: ToolAnnotations;
  handler(input: z.output<Input>, context: ToolContext): Promise<CallToolResult>;
}
