import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { config } from "../config.ts";

const promptUrl = new URL("../../skills/visual-judge/place-check-prompt.md", import.meta.url);

/** The line of `place-check-prompt.md` that gives this script's fill of the brief's `<source>`. */
const evalSourcePrefix = "- From `npm run eval:studio`, `<source>` is: ";

/** What the place-check subagent answers, as `place-check-prompt.md` asks for it. */
const placeAnswerSchema = z.object({
  clues: z.string(),
  genre: z.string(),
  room: z.string(),
});

export type PlaceAnswer = z.output<typeof placeAnswerSchema>;

/**
 * The blind check of one typed room: what the reviewer named and whether it matches the spec, or why the
 * reviewer gave no answer, which fails the check.
 */
export interface PlaceCheckResult {
  room: string;
  genre: string;
  roomType: string;
  answer?: PlaceAnswer;
  error?: string;
  passed: boolean;
}

/** The answer's JSON Schema for `claude --json-schema`, which rejects zod's `$schema` key. */
function answerJsonSchema(): string {
  const schema: Record<string, unknown> = { ...z.toJSONSchema(placeAnswerSchema) };
  delete schema["$schema"];
  return JSON.stringify(schema);
}

/**
 * The brief of `place-check-prompt.md` (the text after its first rule) with `<source>` filled by the prompt's
 * own eval line, naming `imageNames`.
 */
export function placeCheckBrief(promptText: string, imageNames: string[]): string {
  const sourceLine = promptText.split("\n").find((line) => line.startsWith(evalSourcePrefix));
  const ruleIndex = promptText.indexOf("\n---\n");
  if (sourceLine === undefined || ruleIndex < 0) {
    throw new Error(
      `place-check-prompt.md has no line starting "${evalSourcePrefix}" or no "---" rule before the brief.`,
    );
  }
  const source = sourceLine
    .slice(evalSourcePrefix.length)
    .replace("`<paths>`", imageNames.map((name) => `\`${name}\``).join(" and "));
  return promptText
    .slice(ruleIndex + "\n---\n".length)
    .replace("<source>", source)
    .trim();
}

/** A room name as the skill compares it: case ignored, spaces and hyphens alike. */
function normalizedRoom(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "-");
}

/** Whether the reviewer named the spec's genre and room type (SKILL.md step 5); `unknown` never matches. */
export function placeMatches(answer: PlaceAnswer, genre: string, roomType: string): boolean {
  return answer.genre === genre && normalizedRoom(answer.room) === normalizedRoom(roomType);
}

const run = promisify(execFile);

/**
 * Asks a fresh headless Claude Code session, which can only read, to name the place in two images of one
 * room. The images are copied into an empty temporary folder as `image-1` and `image-2`, so neither the
 * file names nor the repository can give the room away; the folder is removed afterwards.
 */
async function askReviewer(imagePaths: string[]): Promise<PlaceAnswer> {
  const folder = await mkdtemp(join(tmpdir(), "roblox-kit-place-check-"));
  try {
    const imageNames = imagePaths.map(
      (path, index) => `image-${String(index + 1)}${extname(path)}`,
    );
    await Promise.all(
      imagePaths.map((path, index) => copyFile(path, join(folder, imageNames[index] ?? ""))),
    );
    const brief = placeCheckBrief(await readFile(promptUrl, "utf8"), imageNames);
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
      { cwd: folder, timeout: config.placeCheckTimeoutMs, maxBuffer: 10 * 1024 * 1024 },
    );
    pending.child.stdin?.end(brief);
    const { stdout } = await pending;
    const reply = z
      .object({ is_error: z.boolean(), result: z.string(), structured_output: z.unknown() })
      .parse(JSON.parse(stdout));
    if (reply.is_error) {
      throw new Error(`The place-check reviewer failed: ${reply.result}`);
    }
    return placeAnswerSchema.parse(reply.structured_output);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * Runs the blind place check on one typed room from its view a and view b images. A reviewer that fails,
 * times out or answers off-schema fails the check with its error, so one room cannot stop the others.
 */
export async function blindPlaceCheck(
  room: string,
  genre: string,
  roomType: string,
  imagePaths: string[],
): Promise<PlaceCheckResult> {
  try {
    const answer = await askReviewer(imagePaths);
    return { room, genre, roomType, answer, passed: placeMatches(answer, genre, roomType) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { room, genre, roomType, error: message, passed: false };
  }
}
