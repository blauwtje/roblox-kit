import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { config } from "../config.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio, type StudioConnection } from "../studio/studio-connection.ts";
import { clientHarnessSource, serverHarnessSource } from "./harness-source.ts";

const modeSchema = z.enum(["run", "play", "multiplayer"]);

const runPlaytestInput = z.strictObject({
  /**
   * `run`: server only, no player. `play`: one solo player. `multiplayer`: `players` clients.
   * Defaults to `play`.
   */
  mode: modeSchema.optional(),
  /** Number of clients of a `multiplayer` session; defaults to 2. */
  players: z
    .number()
    .int()
    .min(config.minPlaytestPlayers)
    .max(config.maxPlaytestPlayers)
    .optional(),
  /** Luau body of `runChecks(check, expectedClients)` on the server. */
  serverChecks: z.string().optional(),
  /** Luau body of `runChecks(check, player)` that every client runs. */
  clientChecks: z.string().optional(),
  /** How long the harness waits for the server checks and every client report. */
  timeoutSeconds: z.number().int().min(1).max(config.maxPlaytestTimeoutSeconds).optional(),
  /** Which Studio runs the test; optional while exactly one is connected. */
  studioId: z.string().min(1).optional(),
});

const checkSchema = z.strictObject({ name: z.string(), passed: z.boolean(), detail: z.string() });
const peerSchema = z.strictObject({ peer: z.string(), checks: z.array(checkSchema) });

const runPlaytestOutput = z.strictObject({
  passed: z.boolean(),
  /** The server first, then each client that reported under its player name. */
  peers: z.array(peerSchema),
  /** Counts over the checks of every peer. */
  checks: z.strictObject({
    total: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
  }),
  /** Problems outside single checks, such as clients that never reported. */
  errors: z.array(z.string()),
  durationMs: z.number().int(),
});

/** What `run-playtest.luau` returns: the harness's EndTest report, absent when the test ended by other means. */
const sessionSchema = z.strictObject({
  ended: z.boolean(),
  report: z.strictObject({ peers: z.array(peerSchema), errors: z.array(z.string()) }).optional(),
});

interface PlaytestPlan {
  mode: z.output<typeof modeSchema>;
  players: number;
  expectedClients: number;
  timeoutSeconds: number;
  serverChecks: string;
  clientChecks: string;
}

function planPlaytest(input: z.output<typeof runPlaytestInput>): PlaytestPlan {
  const mode = input.mode ?? "play";
  if (input.players !== undefined && mode !== "multiplayer") {
    throw new Error(
      `players only applies to mode "multiplayer", not "${mode}". Drop players or set the mode.`,
    );
  }
  if (mode === "run" && input.clientChecks !== undefined) {
    throw new Error(
      'mode "run" starts no client, so clientChecks would never run. Use mode "play" or "multiplayer", or drop clientChecks.',
    );
  }
  if (input.serverChecks === undefined && input.clientChecks === undefined) {
    throw new Error("Give serverChecks or clientChecks: a playtest without checks proves nothing.");
  }
  const players = input.players ?? config.defaultMultiplayerPlayers;
  const expectedClients = { run: 0, play: 1, multiplayer: players }[mode];
  return {
    mode,
    players,
    expectedClients,
    timeoutSeconds: input.timeoutSeconds ?? config.defaultPlaytestTimeoutSeconds,
    serverChecks: input.serverChecks ?? "",
    clientChecks: input.clientChecks ?? "",
  };
}

type Settled<Value> = { ok: true; value: Value } | { ok: false; error: unknown };

/** Runs the session call; resolves `"timed-out"` when it outlasts `deadlineMs`, and reports a late failure to nobody. */
async function settleWithin<Value>(
  work: Promise<Value>,
  deadlineMs: number,
): Promise<Settled<Value> | "timed-out"> {
  const controller = new AbortController();
  const settled = work.then(
    (value): Settled<Value> => ({ ok: true, value }),
    (error: unknown): Settled<Value> => ({ ok: false, error }),
  );
  const timedOut = sleep(deadlineMs, "timed-out" as const, { signal: controller.signal });
  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    controller.abort();
    timedOut.catch(() => undefined);
  }
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function removeHarness(connection: StudioConnection, studioId: string): Promise<void> {
  await runLuauFile({
    connection,
    studioId,
    fileName: "run-playtest.luau",
    datamodelType: "Edit",
    arguments: { action: "cleanup" },
    resultSchema: sessionSchema,
  });
}

/** Stops a test that outlived its deadline; returns a note when even that failed. */
async function stopTest(connection: StudioConnection, studioId: string): Promise<string> {
  try {
    const stopped = await connection.callTool({
      name: "start_stop_play",
      studioId,
      arguments: { is_start: false },
    });
    return stopped.isError === true
      ? " Stopping the test through start_stop_play failed; stop it in Studio."
      : "";
  } catch (error) {
    return ` Stopping the test through start_stop_play failed (${describeFailure(error)}); stop it in Studio.`;
  }
}

function summarize(
  peers: z.output<typeof peerSchema>[],
  reportedErrors: string[],
  durationMs: number,
): z.output<typeof runPlaytestOutput> {
  const allChecks = peers.flatMap((peer) => peer.checks);
  const failed = allChecks.filter((check) => !check.passed).length;
  const errors = [...reportedErrors];
  if (allChecks.length === 0) {
    errors.push("No check was recorded: the checks never called check(name, passed, detail).");
  }
  return {
    passed: errors.length === 0 && failed === 0,
    peers,
    checks: { total: allChecks.length, passed: allChecks.length - failed, failed },
    errors,
    durationMs,
  };
}

/** Builds the tool; `deadlineMarginMs` is how long past the harness timeout the session call may take. */
export function createRunPlaytestTool(
  deadlineMarginMs: number = config.playtestCallMarginSeconds * 1000,
): ToolDefinition<typeof runPlaytestInput, typeof runPlaytestOutput> {
  return {
    name: "run_playtest",
    title: "Run playtest",
    description:
      `Runs your Luau checks in a Studio playtest and returns a pass or fail report per check per peer. ` +
      `Inserts a server harness Script into ServerScriptService and, for play and multiplayer, a client harness LocalScript into StarterPlayerScripts, runs StudioTestService, and removes both scripts afterwards even on failure. ` +
      `mode is run (server only), play (one player, the default) or multiplayer (players ${String(config.minPlaytestPlayers)} to ${String(config.maxPlaytestPlayers)}). ` +
      `serverChecks is the body of runChecks(check, expectedClients) and clientChecks the body of runChecks(check, player); call check(name, passed, detail) for each result. A check body that throws becomes a failed check. ` +
      `timeoutSeconds (1 to ${String(config.maxPlaytestTimeoutSeconds)}, default ${String(config.defaultPlaytestTimeoutSeconds)}) bounds the wait; a client that has not reported by then is an error. ` +
      `Starts and stops play mode, so it changes Studio's state and needs an open place in Edit mode. ` +
      `Returns { passed, peers, checks, errors, durationMs }: peers lists the server first, then each client by player name.`,
    inputSchema: runPlaytestInput,
    outputSchema: runPlaytestOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(input, context) {
      const plan = planPlaytest(input);
      const studioId = await selectStudio(context.studio, input.studioId);
      const serverSource = await serverHarnessSource(plan.serverChecks);
      const clientSource = await clientHarnessSource(plan.clientChecks);
      const startedAt = Date.now();
      const session = await settleWithin(
        runLuauFile({
          connection: context.studio,
          studioId,
          fileName: "run-playtest.luau",
          datamodelType: "Edit",
          arguments: { action: "run", ...plan, serverSource, clientSource },
          resultSchema: sessionSchema,
          timeoutMs: plan.timeoutSeconds * 1000 + deadlineMarginMs,
        }),
        plan.timeoutSeconds * 1000 + deadlineMarginMs,
      );
      const stopNote = session === "timed-out" ? await stopTest(context.studio, studioId) : "";
      let removalFailure: string | undefined;
      try {
        await removeHarness(context.studio, studioId);
      } catch (error) {
        removalFailure = describeFailure(error);
      }
      const removalNote =
        removalFailure === undefined
          ? ""
          : ` The harness scripts RobloxKitPlaytestServerHarness (ServerScriptService) and RobloxKitPlaytestClientHarness (StarterPlayerScripts) may still be in the place (${removalFailure}); delete them.`;
      if (session === "timed-out") {
        throw new Error(
          `The playtest did not end within ${String(plan.timeoutSeconds)} s plus ${String(deadlineMarginMs / 1000)} s. The server harness only ends the test once it compiles, so the usual cause is a syntax error in serverChecks or clientChecks: read get_console_output for the script error, fix the check body and retry.${stopNote}${removalNote}`,
        );
      }
      if (!session.ok) {
        throw new Error(`${describeFailure(session.error)}${removalNote}`);
      }
      if (removalNote !== "") {
        throw new Error(`The playtest ran.${removalNote}`);
      }
      if (session.value.report === undefined) {
        throw new Error(
          "The test session ended without a report: it was stopped before the server harness ended it. Do not stop play while run_playtest runs.",
        );
      }
      const { peers, errors } = session.value.report;
      return toolResult(summarize(peers, errors, Date.now() - startedAt));
    },
  };
}
