import type { CallToolResult } from "@modelcontextprotocol/server";

/** Failed tool result carrying the error message, which tools write as what failed and how to fix it. */
export function toolErrorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}
