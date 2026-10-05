import { config } from "../config.ts";
import { selectStudio, type StudioConnection } from "./studio-connection.ts";

const modePattern = /Current Studio Mode:\s*(\S+)/;

export interface AwaitEditModeOptions {
  studioId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Waits until `get_studio_state` reports Studio in Edit mode and returns the studio id. Throws naming the last
 * reported mode when `config.studioEditModeTimeoutMs` passes first, since `execute_luau` on the Edit
 * DataModel fails while a playtest runs or is still shutting down.
 */
export async function awaitEditMode(
  connection: StudioConnection,
  options: AwaitEditModeOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? config.studioEditModeTimeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? config.studioEditModePollIntervalMs;
  const studioId = await selectStudio(connection, options.studioId);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await connection.callTool({ name: "get_studio_state", studioId, arguments: {} });
    const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const lastMode =
      result.isError === true ? `error: ${text}` : (modePattern.exec(text)?.[1] ?? text);
    if (result.isError !== true && lastMode === "Edit") return studioId;
    if (Date.now() >= deadline) {
      throw new Error(
        `Studio did not reach Edit mode within ${String(timeoutMs)} ms (last reported: ${lastMode}); stop the playtest in Studio and rerun`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
