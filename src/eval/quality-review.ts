import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { config } from "../config.ts";
import { loadPresets } from "../style/load-preset.ts";

const promptUrl = new URL("../../skills/visual-judge/quality-prompt.md", import.meta.url);

export const qualityAxes = [
  "palette",
  "focalHierarchy",
  "negativeSpace",
  "readability",
  "atmosphere",
  "lighting",
] as const;

export type QualityAxis = (typeof qualityAxes)[number];

const axisAnswerSchema = z.object({
  evidence: z.string().min(1),
  score: z.number().int().min(1).max(10),
});

/** What one reviewer answers, as `quality-prompt.md` asks for it: an evidence note and a score per axis. */
const qualityAnswerSchema = z.object({
  palette: axisAnswerSchema,
  focalHierarchy: axisAnswerSchema,
  negativeSpace: axisAnswerSchema,
  readability: axisAnswerSchema,
  atmosphere: axisAnswerSchema,
  lighting: axisAnswerSchema,
});

export type QualityAnswer = z.output<typeof qualityAnswerSchema>;

/** The median score of each axis over a room's reviewers. */
export type AxisMedians = Record<QualityAxis, number>;

export type AxisEvidence = Record<QualityAxis, string[]>;

/**
 * The quality review of one room: the per-axis medians with the evidence notes behind them, or why a
 * reviewer gave no answer, which fails the room.
 */
export interface QualityResult {
  room: string;
  genre: string;
  roomType: string;
  medians?: AxisMedians;
  evidence?: AxisEvidence;
  error?: string;
  passed: boolean;
}

/** The answer's JSON Schema for `claude --json-schema`, which rejects zod's `$schema` key. */
function answerJsonSchema(): string {
  const schema: Record<string, unknown> = { ...z.toJSONSchema(qualityAnswerSchema) };
  delete schema["$schema"];
  return JSON.stringify(schema);
}

/**
 * The brief of `quality-prompt.md` (the text after its first rule) with its five fields filled: the genre,
 * the room type, the preset's lighting intent, and one image name per line for the references and for
 * the captures.
 */
export function qualityBrief(
  promptText: string,
  genre: string,
  roomType: string,
  lightingIntent: string,
  referenceNames: string[],
  captureNames: string[],
): string {
  const ruleIndex = promptText.indexOf("\n---\n");
  if (ruleIndex < 0) {
    throw new Error('quality-prompt.md has no "---" rule before the brief.');
  }
  return promptText
    .slice(ruleIndex + "\n---\n".length)
    .replaceAll("<genre>", genre)
    .replaceAll("<room type>", roomType)
    .replaceAll("<lighting intent>", lightingIntent)
    .replace("<reference paths>", referenceNames.join("\n"))
    .replace("<capture paths>", captureNames.join("\n"))
    .trim();
}

/** The middle score of `scores`; the lower middle one when their count is even. */
export function median(scores: number[]): number {
  const sorted = [...scores].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/** The per-axis median of the reviewers' answers. */
export function axisMedians(answers: QualityAnswer[]): AxisMedians {
  const medians = {} as AxisMedians;
  for (const axis of qualityAxes) {
    medians[axis] = median(answers.map((answer) => answer[axis].score));
  }
  return medians;
}

export function axisEvidence(answers: QualityAnswer[]): AxisEvidence {
  const evidence = {} as AxisEvidence;
  for (const axis of qualityAxes) {
    evidence[axis] = answers.map((answer) => answer[axis].evidence);
  }
  return evidence;
}

/** Whether every axis median reaches `config.visualPassScore`; one weak axis fails the room. */
export function reachesPassScore(medians: AxisMedians): boolean {
  return qualityAxes.every((axis) => medians[axis] >= config.visualPassScore);
}

const run = promisify(execFile);

/**
 * Asks a fresh headless Claude Code session, which can only read, to score a room's captures against the
 * references. The images are copied into an empty temporary folder as `reference-N` and `capture-N`, so
 * neither the file names nor the repository can give the room or the game away; the folder is removed
 * afterwards.
 */
async function askReviewer(
  genre: string,
  roomType: string,
  lightingIntent: string,
  referencePaths: string[],
  capturePaths: string[],
): Promise<QualityAnswer> {
  const folder = await mkdtemp(join(tmpdir(), "roblox-kit-quality-review-"));
  try {
    const neutralName = (prefix: string) => (path: string, index: number) =>
      `${prefix}-${String(index + 1)}${extname(path)}`;
    const referenceNames = referencePaths.map(neutralName("reference"));
    const captureNames = capturePaths.map(neutralName("capture"));
    const imageNames = [...referenceNames, ...captureNames];
    const copies = [...referencePaths, ...capturePaths].map((path, index) =>
      copyFile(path, join(folder, imageNames[index] ?? "")),
    );
    await Promise.all(copies);
    const brief = qualityBrief(
      await readFile(promptUrl, "utf8"),
      genre,
      roomType,
      lightingIntent,
      referenceNames,
      captureNames,
    );
    // The brief goes in on stdin: `-p` with no prompt argument reads it from there.
    const pending = run(
      "claude",
      [
        "-p",
        "--tools",
        "Read",
        "--allowedTools",
        "Read",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--no-session-persistence",
        "--output-format",
        "json",
        "--json-schema",
        answerJsonSchema(),
      ],
      { cwd: folder, timeout: config.qualityReviewTimeoutMs, maxBuffer: 10 * 1024 * 1024 },
    );
    pending.child.stdin?.end(brief);
    const { stdout } = await pending;
    const reply = z
      .object({ is_error: z.boolean(), result: z.string(), structured_output: z.unknown() })
      .parse(JSON.parse(stdout));
    if (reply.is_error) {
      throw new Error(`The quality reviewer failed: ${reply.result}`);
    }
    return qualityAnswerSchema.parse(reply.structured_output);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** The lighting intent the bundled preset named `genre` declares; throws when no such preset exists. */
async function presetLightingIntent(genre: string): Promise<string> {
  const preset = (await loadPresets()).get(genre);
  if (preset === undefined) {
    throw new Error(`No preset named ${genre} declares a lighting intent.`);
  }
  return preset.lightingIntent;
}

/**
 * Scores one room: `config.qualityReviewersPerRoom` fresh reviewers each rate its captures (eye view first)
 * against the references and the preset's lighting intent, and each axis takes the median of the scores
 * and keeps every evidence note. A reviewer that fails, times out or answers
 * off-schema fails the room with its error, so one room cannot stop the others.
 */
export async function reviewRoomQuality(
  room: string,
  genre: string,
  roomType: string,
  referencePaths: string[],
  capturePaths: string[],
): Promise<QualityResult> {
  try {
    const lightingIntent = await presetLightingIntent(genre);
    const reviewers = Array.from({ length: config.qualityReviewersPerRoom }, () =>
      askReviewer(genre, roomType, lightingIntent, referencePaths, capturePaths),
    );
    const answers = await Promise.all(reviewers);
    const medians = axisMedians(answers);
    return {
      room,
      genre,
      roomType,
      medians,
      evidence: axisEvidence(answers),
      passed: reachesPassScore(medians),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { room, genre, roomType, error: message, passed: false };
  }
}
