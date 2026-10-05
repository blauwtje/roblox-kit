import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { config } from "../config.ts";
import { relationMapSpecSchema } from "../map/map-spec.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { loadPresets } from "../style/load-preset.ts";
import {
  judgeFindingSchema,
  judgeRound,
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

const judgeRoundInput = z.strictObject({
  /** The round of this loop, starting at 1. */
  round: z.int().min(1),
  /** The spec that `build_map` built, with its `mapId`. */
  spec: relationMapSpecSchema,
  /** The zones judged this round. */
  zones: z.array(z.string().min(1)),
  /** The findings the `visual-judge` agent returned. */
  findings: z.array(judgeFindingSchema),
  /** The place-check agent's answer for each typed room. */
  placeChecks: z.array(z.strictObject({ zone: z.string().min(1), answer: placeAnswerSchema })),
  /** The quality reviewers' answers for each room. */
  qualityAnswers: z.array(
    z.strictObject({
      zone: z.string().min(1),
      answers: z.array(qualityAnswerSchema).length(config.qualityReviewersPerRoom),
    }),
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
  stopReason: z.enum(["pass", "round-limit", "repeat"]).nullable(),
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

const ignoredEntry = `${config.judgeLogFile.split("/")[0] ?? ""}/`;

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

/** The log's lines that read as rounds; a line that does not (hand-edited, cut) cannot take part in repeat detection and is skipped. */
function parseLog(text: string | null): LoggedRound[] {
  const rounds: LoggedRound[] = [];
  for (const line of (text ?? "").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    try {
      const parsed = loggedRoundSchema.safeParse(JSON.parse(line));
      if (parsed.success) {
        rounds.push(parsed.data);
      }
    } catch {
      continue;
    }
  }
  return rounds;
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

/** The names each room type of the spec's preset accepts besides its own; none when the spec has no known preset. */
async function acceptedNamesOf(preset: string | undefined): Promise<Record<string, string[]>> {
  if (preset === undefined) {
    return {};
  }
  const roomTypes = (await loadPresets()).get(preset)?.roomTypes ?? {};
  return Object.fromEntries(
    Object.entries(roomTypes).map(([name, roomType]) => [name, roomType.roomNames ?? []]),
  );
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
      `turns place-check mismatches and empty answers into spec-miss blocker findings, turns each quality axis median below ${String(config.visualPassScore)} into a major finding, ` +
      `marks repeats of earlier rounds, sets stopReason (pass, round-limit at round ${String(config.maxJudgeRounds)}, repeat or null) and appends one line to ${config.judgeLogFile} in the project folder. ` +
      `Dispatching the agents stays with the caller.`,
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
      const logFile = join(folder, config.judgeLogFile);
      const logged = parseLog(await readIfPresent(logFile));
      const roundInput: JudgeRoundInput = {
        ...input,
        acceptedNames: await acceptedNamesOf(input.spec.style?.preset),
      };
      const { result, rejected } = judgeRound(roundInput, logged, new Date().toISOString());
      await mkdir(dirname(logFile), { recursive: true });
      await appendFile(logFile, `${JSON.stringify(result)}\n`);
      await ensureGitignored(folder);
      return toolResult({ ...result, rejected, logFile });
    },
  };
}
