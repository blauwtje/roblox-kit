import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { config } from "../../src/config.ts";
import { pluginVersion } from "../../src/server/main.ts";
import { awaitEditMode } from "../../src/studio/await-edit-mode.ts";
import type { StudioConnection } from "../../src/studio/studio-connection.ts";
import { StudioMcpClient } from "../../src/studio/studio-mcp-client.ts";
import { acquireStudioLock } from "../../src/studio/studio-lock.ts";
import { assertViewportVisible } from "../../src/studio/viewport-preflight.ts";

type ParsedValues = ReturnType<typeof parseArgs<{ options: ParseArgsOptionsConfig }>>["values"];

export interface ScriptDefinition {
  name: string;
  usage: string;
  options?: ParseArgsOptionsConfig;
  run: (values: ParsedValues) => Promise<number> | number;
}

export async function runScript(definition: ScriptDefinition): Promise<void> {
  const options: ParseArgsOptionsConfig = {
    ...definition.options,
    help: { type: "boolean", short: "h" },
  };
  let values: ParsedValues;
  try {
    values = parseArgs({ options, allowPositionals: false }).values;
  } catch (error) {
    console.error(`${definition.name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(definition.usage);
    process.exitCode = 2;
    return;
  }
  if (values.help === true) {
    console.log(definition.usage);
    return;
  }
  try {
    const status = await definition.run(values);
    if (status !== 0) {
      process.exitCode = status;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export interface WithStudioOptions {
  name: string;
  lockFile?: string;
  connect?: () => StudioConnection;
  checkViewport?: (connection: StudioConnection) => Promise<void>;
}

/**
 * Runs `run` with exclusive use of Studio: takes the lock, connects, waits for Edit mode and checks the viewport
 * is visible, then always closes the connection and releases the lock, also when any step or `run` throws.
 */
export async function withStudio<T>(
  options: WithStudioOptions,
  run: (connection: StudioConnection, studioId: string) => Promise<T>,
): Promise<T> {
  const lockFile =
    options.lockFile ?? fileURLToPath(new URL(`../../${config.studioLockFile}`, import.meta.url));
  const release = await acquireStudioLock({ lockFile });
  try {
    const connection =
      options.connect?.() ??
      new StudioMcpClient({
        clientInfo: { name: `${config.serverName}-${options.name}`, version: pluginVersion },
        timeoutMs: config.upstreamTimeoutMs,
      });
    try {
      const studioId = await awaitEditMode(connection);
      await (options.checkViewport ?? assertViewportVisible)(connection);
      return await run(connection, studioId);
    } finally {
      await connection.close();
    }
  } finally {
    await release();
  }
}
