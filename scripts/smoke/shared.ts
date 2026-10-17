import { awaitEditMode } from "../../src/studio/await-edit-mode.ts";
import { z } from "zod";
import { loadPresets } from "../../src/style/load-preset.ts";
import type { ToolDefinition } from "../../src/server/tool-definition.ts";
import { type StudioConnection } from "../../src/studio/studio-connection.ts";

export const presets = await loadPresets();

export const capabilitiesSchema = z.array(
  z.object({ capability: z.string(), ok: z.boolean(), detail: z.string() }),
);

export type Capability = z.output<typeof capabilitiesSchema>[number];

/** Runs one tool call and turns its outcome into a capability entry. */
export async function probeTool(
  capability: string,
  attempt: () => Promise<string>,
): Promise<Capability> {
  try {
    return { capability, ok: true, detail: await attempt() };
  } catch (error) {
    return {
      capability,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

export async function executeLuau(
  connection: StudioConnection,
  studioId: string,
  code: string,
): Promise<string> {
  await awaitEditMode(connection, { studioId });
  const result = await connection.callTool({
    name: "execute_luau",
    studioId,
    arguments: { code, datamodel_type: "Edit" },
  });
  if (result.isError === true) {
    throw new Error(`execute_luau failed: ${textOf(result)}`);
  }
  return textOf(result);
}

export function expectEqual(what: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Calls a tool the way the server registry does: input parsed by its schema, output by its own. */
export async function callRealTool<Input extends z.ZodObject, Output extends z.ZodObject>(
  tool: ToolDefinition<Input, Output>,
  rawInput: z.input<Input>,
  connection: StudioConnection,
) {
  const result = await tool.handler(tool.inputSchema.parse(rawInput), { studio: connection });
  if (result.isError === true) {
    throw new Error(`${tool.name} returned an error: ${textOf(result)}`);
  }
  const output = tool.outputSchema.parse(result.structuredContent);
  return { output, content: result.content };
}

export function expectClose(what: string, actual: number, expected: number): void {
  if (Math.abs(actual - expected) > 1e-3) {
    throw new Error(`${what}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
