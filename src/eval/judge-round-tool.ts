import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { evalConfig } from "./eval-config.ts";
import { relationMapSpecSchema } from "../map/map-spec.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { decodeImage } from "../vision/decode-image.ts";
import { loadPresets } from "../style/load-preset.ts";
import { resolveStyle, type StyleSelection } from "../style/resolve-style.ts";
import { imageStatsOf } from "./code-score.ts";
import {
  judgeFindingSchema,
  judgeRound,
  type GateInput,
  type JudgeRoundInput,
  type LoggedRound,
} from "./judge-round.ts";

const axisAnswerSchema = z.strictObject({
  evidence: z.string().min(1),
  score: z.number().int().min(1).max(10),
});

/** One reviewer's answer, as `quality-prompt.md` asks for it (the same shape as in `quality-review.ts`). */
const qualityAnswerSchema = z.strictObject({
  palette: axisAnswerSchema,
  focalHierarchy: axisAnswerSchema,
  negativeSpace: axisAnswerSchema,
  readability: axisAnswerSchema,
  atmosphere: axisAnswerSchema,
  lighting: axisAnswerSchema,
});

const placeAnswerSchema = z.strictObject({
  clues: z.string(),
  genre: z.string(),
  room: z.string(),
  furnished: z.enum(["furnished", "empty"]),
});

const gateInputSchema = z.strictObject({
  check: z.strictObject({
    passed: z.boolean(),
    counts: z.record(z.string(), z.int().min(0)),
    sceneStats: z.array(
      z.strictObject({ zone: z.string(), drawCalls: z.int(), triangles: z.int() }),
    ),
    budget: z.strictObject({ maxDrawCalls: z.int(), maxTriangles: z.int() }),
  }),
  images: z.array(z.strictObject({ imageId: z.string().min(1), path: z.string().min(1) })),
});

const judgeRoundInput = z.strictObject({
  round: z.int().min(1).describe("The round of this loop, starting at 1."),
  spec: relationMapSpecSchema.describe("The spec build_map built, with its mapId."),
  zones: z.array(z.string().min(1)).describe("The zones judged this round."),
  findings: z.array(judgeFindingSchema).describe("The findings the visual-judge agent returned."),
  placeChecks: z
    .array(z.strictObject({ zone: z.string().min(1), answer: placeAnswerSchema }))
    .describe("The place-check answer for each typed room."),
  qualityAnswers: z
    .array(
      z.strictObject({
        zone: z.string().min(1),
        answers: z.array(qualityAnswerSchema).length(evalConfig.qualityReviewersPerRoom),
      }),
    )
    .describe("The quality reviewers' answers for each room."),
  gate: gateInputSchema
    .optional()
    .describe(
      "Runs the deterministic capture gate first; a failed gate ends the round on its blocker findings.",
    ),
});

const outputFindingSchema = z.looseObject({
  type: z.string(),
  severity: z.enum(["blocker", "major", "minor"]),
  cites: z.string(),
  repeat: z.boolean(),
});

const judgeRoundOutput = z.strictObject({
  round: z.int(),
  date: z.string(),
  mapId: z.string(),
  zones: z.array(z.string()),
  scores: z.array(z.looseObject({ zone: z.string() })),
  findings: z.array(outputFindingSchema),
  /** The judge's findings that showed nothing (no `evidence.visible`); they are not in `findings`. */
  rejected: z.array(z.looseObject({})),
  gate: z.strictObject({ passed: z.boolean(), codeScore: z.number() }).optional(),
  stopReason: z.enum(["pass", "round-limit", "repeat"]).nullable(),
  /** Log lines that could not be read as rounds and so did not count toward repeat detection. */
  warnings: z.array(z.string()),
  logFile: z.string(),
});

const loggedRoundSchema = z.looseObject({
  round: z.int(),
  mapId: z.string(),
  findings: z.array(
    z.looseObject({
      type: z.string(),
      cites: z.string(),
      evidence: z.looseObject({ imageId: z.string() }),
    }),
  ),
});

const ignoredEntry = `${evalConfig.judgeLogFile.split("/")[0] ?? ""}/`;

/** The project folder when it is an absolute path the host really expanded; throws before anything is written otherwise. */
function checkedProjectDir(projectDir: string | undefined): string {
  if (projectDir === undefined || projectDir.trim() === "") {
    throw new Error(
      "PROJECT_DIR is not set, so judge_round has no project folder to write its log to.",
    );
  }
  if (projectDir.includes("${")) {
    throw new Error(
      `PROJECT_DIR was not expanded (${projectDir}); the host did not substitute CLAUDE_PROJECT_DIR.`,
    );
  }
  if (!isAbsolute(projectDir)) {
    throw new Error(`PROJECT_DIR must be an absolute path, got ${projectDir}.`);
  }
  return projectDir;
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** The log's lines that read as rounds; a line that does not (hand-edited, cut) cannot take part in repeat detection, so it is skipped and counted. */
function parseLog(text: string | null): { rounds: LoggedRound[]; skipped: number } {
  const rounds: LoggedRound[] = [];
  let skipped = 0;
  for (const line of (text ?? "").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    const parsed = loggedRoundSchema.safeParse(value);
    if (parsed.success) {
      rounds.push(parsed.data);
    } else {
      skipped += 1;
    }
  }
  return { rounds, skipped };
}

async function ensureGitignored(projectDir: string): Promise<void> {
  const path = join(projectDir, ".gitignore");
  const text = await readIfPresent(path);
  const entries = (text ?? "").split("\n").map((line) => line.trim());
  if (entries.includes(ignoredEntry) || entries.includes(ignoredEntry.slice(0, -1))) {
    return;
  }
  const separator = text === null || text === "" || text.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${text ?? ""}${separator}${ignoredEntry}\n`);
}

/** The names each room type of the spec's style accepts besides its own, overrides included as `build_map` resolves them; none when the spec has no style. */
async function acceptedNamesOf(
  style: StyleSelection | undefined,
): Promise<Record<string, string[]>> {
  if (style === undefined) {
    return {};
  }
  const roomTypes = resolveStyle(await loadPresets(), style).roomTypes ?? {};
  return Object.fromEntries(
    Object.entries(roomTypes).map(([name, roomType]) => [name, roomType.roomNames ?? []]),
  );
}

async function gateInputOf(gate: z.output<typeof gateInputSchema>): Promise<GateInput> {
  const images = await Promise.all(
    gate.images.map(async ({ imageId, path }) => ({
      imageId,
      stats: imageStatsOf(decodeImage(await readFile(path))),
    })),
  );
  const { passed, counts, sceneStats, budget } = gate.check;
  return { checkPassed: passed, counts, sceneStats, budget, images };
}

/** `projectDir` is the user's project folder (`PROJECT_DIR`); a bad value fails each call before any write, not the server. */
export function createJudgeRoundTool(
  projectDir: string | undefined,
): ToolDefinition<typeof judgeRoundInput, typeof judgeRoundOutput> {
  return {
    name: "judge_round",
    title: "Judge a visual-judge round",
    description:
      `Decides one round of the visual-judge loop from what its agents returned: drops judge findings without evidence.visible (returned as rejected), ` +
      `turns place-check mismatches and empty answers into spec-miss blocker findings, turns each quality axis median below ${String(evalConfig.visualPassScore)} into a major finding, ` +
      `marks repeats of earlier rounds (warning of log lines it could not read), sets stopReason (pass, round-limit at round ${String(evalConfig.maxJudgeRounds)}, repeat or null) and appends one line to ${evalConfig.judgeLogFile} in the project folder. ` +
      `The optional gate (check_map result and capture paths) runs first and its failure ends the round on blocker findings. Other inputs are required. Dispatching the agents stays with the caller.`,
    inputSchema: judgeRoundInput,
    outputSchema: judgeRoundOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(input) {
      const folder = checkedProjectDir(projectDir);
      const logFile = join(folder, evalConfig.judgeLogFile);
      const { rounds: logged, skipped } = parseLog(await readIfPresent(logFile));
      const warnings =
        skipped === 0
          ? []
          : [
              `${String(skipped)} line(s) of ${evalConfig.judgeLogFile} could not be read as rounds and were skipped, so repeats of those rounds are not detected.`,
            ];
      const { gate, ...rest } = input;
      const roundInput: JudgeRoundInput = {
        ...rest,
        ...(gate === undefined ? {} : { gate: await gateInputOf(gate) }),
        acceptedNames: await acceptedNamesOf(input.spec.style),
      };
      const { result, rejected } = judgeRound(roundInput, logged, new Date().toISOString());
      await mkdir(dirname(logFile), { recursive: true });
      await appendFile(logFile, `${JSON.stringify(result)}\n`);
      await ensureGitignored(folder);
      return toolResult({ ...result, rejected, warnings, logFile });
    },
  };
}
