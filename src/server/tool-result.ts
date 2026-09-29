import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Successful tool result: the structured value plus the same JSON as text, for clients that read
 * only content. `extraContent` follows the text block (images, resource links).
 */
export function toolResult(
  structured: Record<string, unknown>,
  extraContent: CallToolResult["content"] = [],
): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }, ...extraContent],
    structuredContent: structured,
  };
}
