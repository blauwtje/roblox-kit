import { z } from "zod";
import { config } from "../config.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio } from "../studio/studio-connection.ts";
import { playtestProbeSource } from "./harness-source.ts";

const runInPlaytestInput = z.strictObject({
  /** Luau body that runs in the server of the running playtest and returns one JSON-encodable value. */
  code: z.string().min(1),
  /** How long to wait for the code to return. */
  timeoutSeconds: z
    .number()
    .int()
    .min(config.minRunInPlaytestTimeoutSeconds)
    .max(config.maxRunInPlaytestTimeoutSeconds)
    .optional(),
  /** Which Studio; optional while exactly one is connected. */
  studioId: z.string().min(1).optional(),
});

const runInPlaytestOutput = z.strictObject({
  /** What the code returned; null when it returned nothing. */
  value: z.unknown(),
  durationMs: z.number().int(),
});

/** What `run-in-playtest.luau` returns. */
const probeRunSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("timed-out") }),
  z.strictObject({
    status: z.literal("finished"),
    result: z.union([
      z.strictObject({ ok: z.literal(true), value: z.unknown().optional() }),
      z.strictObject({ ok: z.literal(false), error: z.string() }),
    ]),
  }),
]);

export function createRunInPlaytestTool(
  callMarginSeconds: number = config.playtestCallMarginSeconds,
): ToolDefinition<typeof runInPlaytestInput, typeof runInPlaytestOutput> {
  return {
    name: "run_in_playtest",
    title: "Run code in a playtest",
    description:
      `Runs Luau code once in the server of a playtest that is already running and returns the value it returns. ` +
      `Start the playtest first with start_stop_play; this tool never starts or stops one. ` +
      `It inserts a Script into ServerScriptService whose body is code, so require returns the live module instances, unlike execute_luau with datamodel_type Server, which gets its own module copies. ` +
      `code ends with return of one JSON-encodable value (return nothing for null); a throw fails the call with its message. ` +
      `timeoutSeconds (${String(config.minRunInPlaytestTimeoutSeconds)} to ${String(config.maxRunInPlaytestTimeoutSeconds)}, default ${String(config.defaultRunInPlaytestTimeoutSeconds)}) bounds the wait; code that never returns, or does not compile, times out. ` +
      `The Script is removed in every outcome. Server only. For repeatable assertions use run_playtest serverChecks. ` +
      `Returns { value, durationMs }.`,
    inputSchema: runInPlaytestInput,
    outputSchema: runInPlaytestOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(input, context) {
      const timeoutSeconds = input.timeoutSeconds ?? config.defaultRunInPlaytestTimeoutSeconds;
      const studioId = await selectStudio(context.studio, input.studioId);
      const source = await playtestProbeSource(input.code);
      const startedAt = Date.now();
      const run = await runLuauFile({
        connection: context.studio,
        studioId,
        fileName: "run-in-playtest.luau",
        datamodelType: "Server",
        arguments: { source, timeoutSeconds },
        resultSchema: probeRunSchema,
        timeoutMs: (timeoutSeconds + callMarginSeconds) * 1000,
      });
      if (run.status === "timed-out") {
        throw new Error(
          `The code did not return within ${String(timeoutSeconds)} s. The usual causes are a syntax error (read get_console_output for the script error) or code that waits forever; raise timeoutSeconds only for slow code.`,
        );
      }
      if (!run.result.ok) {
        throw new Error(`The code threw: ${run.result.error}`);
      }
      return toolResult({ value: run.result.value ?? null, durationMs: Date.now() - startedAt });
    },
  };
}
