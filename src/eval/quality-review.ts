import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { config } from "../config.ts";

const promptUrl = new URL("../../skills/visual-judge/quality-prompt.md", import.meta.url);

export const qualityAxes = ["scale", "rotation", "placement", "materials", "lighting"] as const;

export type QualityAxis = (typeof qualityAxes)[number];

const axisAnswerSchema = z.object({
  evidence: z.string(),
  score: z.number().int().min(1).max(10),
});

const defectSchema = z.object({
  piece: z.string(),
  problem: z.string(),
  where: z.string(),
});

/** What one reviewer answers, as `quality-prompt.md` asks for it. */
const qualityAnswerSchema = z.object({
  scale: axisAnswerSchema,
  rotation: axisAnswerSchema,
  placement: axisAnswerSchema,
  materials: axisAnswerSchema,
  lighting: axisAnswerSchema,
  defects: z.array(defectSchema),
});

export type QualityAnswer = z.output<typeof qualityAnswerSchema>;

export type QualityDefect = z.output<typeof defectSchema>;

/** The median score of each axis over a room's reviewers. */
export type AxisMedians = Record<QualityAxis, number>;

/**
 * The quality review of one room: the per-axis medians and every defect the reviewers named, or why a
 * reviewer gave no answer, which fails the room.
 */
export interface QualityResult {
  room: string;
  genre: string;
  roomType: string;
  medians?: AxisMedians;
  defects: QualityDefect[];
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
 * The brief of `quality-prompt.md` (the text after its first rule) with its four fields filled: the genre,
 * the room type, and one image name per line for the references and for the captures.
 */
export function qualityBrief(
  promptText: string,
  genre: string,
  roomType: string,
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
    .replace("<reference paths>", referenceNames.join("\n"))
    .replace("<capture paths>", captureNames.join("\n"))
    .trim();
}

/** The middle score of `scores`; the lower middle one when their count is even. */
function median(scores: number[]): number {
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

/** Whether every axis median reaches `config.visualPassScore`; one weak axis fails the room. */
export function reachesPassScore(medians: AxisMedians): boolean {
  return qualityAxes.every((axis) => medians[axis] >= config.visualPassScore);
}

/** Every reviewer's defects in reviewer order, each piece-problem-place triple once. */
export function mergedDefects(answers: QualityAnswer[]): QualityDefect[] {
  const seen = new Set<string>();
  const merged: QualityDefect[] = [];
  for (const defect of answers.flatMap((answer) => answer.defects)) {
    const key = JSON.stringify([defect.piece, defect.problem, defect.where]);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(defect);
    }
  }
  return merged;
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

/**
 * Scores one room: `config.qualityReviewersPerRoom` fresh reviewers each rate its captures (eye view first)
 * against the references, and each axis takes the median. A reviewer that fails, times out or answers
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
    const reviewers = Array.from({ length: config.qualityReviewersPerRoom }, () =>
      askReviewer(genre, roomType, referencePaths, capturePaths),
    );
    const answers = await Promise.all(reviewers);
    const medians = axisMedians(answers);
    return {
      room,
      genre,
      roomType,
      medians,
      defects: mergedDefects(answers),
      passed: reachesPassScore(medians),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { room, genre, roomType, defects: [], error: message, passed: false };
  }
}
