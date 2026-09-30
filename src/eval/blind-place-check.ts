import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { z } from "zod";
import { config } from "../config.ts";
import { askHeadlessReviewer } from "../shared/ask-headless-reviewer.ts";

const promptUrl = new URL("../../skills/visual-judge/place-check-prompt.md", import.meta.url);

/** The line of `place-check-prompt.md` that gives this script's fill of the brief's `<source>`. */
const evalSourcePrefix = "- From `npm run eval:studio`, `<source>` is: ";

/** What the place-check subagent answers, as `place-check-prompt.md` asks for it. */
const placeAnswerSchema = z.object({
  clues: z.string(),
  genre: z.string(),
  room: z.string(),
  furnished: z.enum(["furnished", "empty"]),
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

/** A room name as the skill compares it: case ignored, spaces and hyphens alike, as its words. */
function roomWords(name: string): string[] {
  return name
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((word) => word !== "");
}

/** Whether `words` appear in `named` as one consecutive run; no words never appear. */
function containsRun(named: string[], words: string[]): boolean {
  if (words.length === 0) {
    return false;
  }
  for (let start = 0; start + words.length <= named.length; start += 1) {
    if (words.every((word, offset) => named[start + offset] === word)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the reviewer named the spec's genre and a room name containing the room type or one of its
 * `acceptedNames` as a run of whole words (SKILL.md step 5), and did not call the room `empty`; `unknown`
 * never matches.
 */
export function placeMatches(
  answer: PlaceAnswer,
  genre: string,
  roomType: string,
  acceptedNames: string[],
): boolean {
  const named = roomWords(answer.room);
  return (
    answer.genre === genre &&
    answer.furnished === "furnished" &&
    [roomType, ...acceptedNames].some((accepted) => containsRun(named, roomWords(accepted)))
  );
}

/**
 * Asks a fresh reviewer to name the place in two images of one room. The images go in as `image-1` and
 * `image-2`, so neither the file names nor the repository can give the room away.
 */
async function askReviewer(imagePaths: string[]): Promise<PlaceAnswer> {
  const images = imagePaths.map((path, index) => ({
    path,
    name: `image-${String(index + 1)}${extname(path)}`,
  }));
  const brief = placeCheckBrief(
    await readFile(promptUrl, "utf8"),
    images.map((image) => image.name),
  );
  return askHeadlessReviewer({
    reviewer: "place-check",
    schema: placeAnswerSchema,
    images,
    brief,
    timeoutMs: config.placeCheckTimeoutMs,
  });
}

/**
 * Runs the blind place check on one typed room from its view a and view b images, accepting the room type
 * and its `acceptedNames`. A reviewer that fails,
 * times out or answers off-schema fails the check with its error, so one room cannot stop the others.
 */
export async function blindPlaceCheck(
  room: string,
  genre: string,
  roomType: string,
  acceptedNames: string[],
  imagePaths: string[],
): Promise<PlaceCheckResult> {
  try {
    const answer = await askReviewer(imagePaths);
    return {
      room,
      genre,
      roomType,
      answer,
      passed: placeMatches(answer, genre, roomType, acceptedNames),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { room, genre, roomType, error: message, passed: false };
  }
}
