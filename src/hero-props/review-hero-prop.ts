import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { config } from "../config.ts";
import { askHeadlessReviewer } from "../shared/ask-headless-reviewer.ts";
import { loadPresets } from "../style/load-preset.ts";
import type { Preset } from "../style/preset-schema.ts";
import type { GeneratedHeroProp } from "./generate-hero-prop.ts";

const promptUrl = new URL("../../skills/visual-judge/hero-prop-prompt.md", import.meta.url);
const reviewFileName = "review.json";
const roundsFileName = "rounds.json";

export const heroPropAxes = ["silhouette", "proportions", "style", "roleSeparation"] as const;

export type HeroPropAxis = (typeof heroPropAxes)[number];

const axisAnswerSchema = z.object({
  evidence: z.string().min(1),
  score: z.number().int().min(1).max(10),
});

/** What the reviewer answers, as `hero-prop-prompt.md` asks for it: an evidence note and a score per axis. */
const heroPropAnswerSchema = z.object({
  silhouette: axisAnswerSchema,
  proportions: axisAnswerSchema,
  style: axisAnswerSchema,
  roleSeparation: axisAnswerSchema,
});

export type HeroPropAnswer = z.output<typeof heroPropAnswerSchema>;

/** The `review.json` written beside the renders: a score and note per axis, passing when every axis reaches `config.visualPassScore`. */
export interface HeroPropReview {
  hash: string;
  passed: boolean;
  axes: Record<HeroPropAxis, { score: number; note: string }>;
}

type HeroPropRecipe = NonNullable<Preset["heroProps"]>[string];

/** The review of `answer` for the hero prop with recipe hash `hash`; one weak axis fails it. */
export function reviewFromAnswer(hash: string, answer: HeroPropAnswer): HeroPropReview {
  const axes = {} as HeroPropReview["axes"];
  for (const axis of heroPropAxes) {
    axes[axis] = { score: answer[axis].score, note: answer[axis].evidence };
  }
  const passed = heroPropAxes.every((axis) => axes[axis].score >= config.visualPassScore);
  return { hash, passed, axes };
}

/** One line per surface role of the recipe: its name, the preset's color for it and how many parts it joins. */
function roleLines(recipe: HeroPropRecipe, surfaces: Preset["surfaces"]): string[] {
  const partCounts = new Map<string, number>();
  for (const part of recipe.parts) {
    partCounts.set(part.role, (partCounts.get(part.role) ?? 0) + 1);
  }
  return [...partCounts].map(([role, count]) => {
    const color = surfaces[role as keyof Preset["surfaces"]].color;
    return `- ${role}: ${color}, ${String(count)} parts`;
  });
}

/**
 * The brief of `hero-prop-prompt.md` (the text after its first rule) with its five fields filled: the
 * kind, the recipe's description and size, one line per role and one image name per line.
 */
export function heroPropBrief(
  promptText: string,
  kind: string,
  recipe: HeroPropRecipe,
  surfaces: Preset["surfaces"],
  renderNames: string[],
): string {
  const ruleIndex = promptText.indexOf("\n---\n");
  if (ruleIndex < 0) {
    throw new Error('hero-prop-prompt.md has no "---" rule before the brief.');
  }
  const { width, height, depth } = recipe.size;
  const size = `${String(width)} x ${String(height)} x ${String(depth)} studs`;
  return promptText
    .slice(ruleIndex + "\n---\n".length)
    .replaceAll("<kind>", kind)
    .replace("<description>", recipe.description)
    .replace("<size>", size)
    .replace("<roles>", roleLines(recipe, surfaces).join("\n"))
    .replace("<render names>", renderNames.join("\n"))
    .trim();
}

const roundsSchema = z.array(z.string());

/**
 * Records `hash` in the kind's rounds file as one more round, unless it is already there; throws when a
 * further distinct hash would pass `config.maxHeroPropRounds`. A missing file is a kind with no rounds.
 */
export async function recordRound(roundsFile: URL, hash: string): Promise<void> {
  let hashes: string[] = [];
  try {
    hashes = roundsSchema.parse(JSON.parse(await readFile(roundsFile, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (hashes.includes(hash)) return;
  if (hashes.length >= config.maxHeroPropRounds) {
    throw new Error(
      `Refusing a round for recipe ${hash}: this kind already used its ${String(config.maxHeroPropRounds)} rounds (${hashes.join(", ")}).`,
    );
  }
  await mkdir(new URL("./", roundsFile), { recursive: true });
  await writeFile(roundsFile, JSON.stringify([...hashes, hash], null, 2));
}

/**
 * Reviews the three renders of a generated hero prop with a fresh reviewer, scored against its recipe, and
 * writes `review.json` beside them. Counts a round first in `<preset>-<kind>/rounds.json` beside the
 * generated folder, and throws without asking when the kind has used its rounds on other recipes.
 */
export async function reviewHeroProp(
  presetName: string,
  kind: string,
  generated: GeneratedHeroProp,
  renders: URL[],
): Promise<HeroPropReview> {
  const preset = (await loadPresets()).get(presetName);
  const recipe = preset?.heroProps?.[kind];
  if (preset === undefined || recipe === undefined) {
    throw new Error(`No hero prop "${kind}" in preset "${presetName}".`);
  }
  await recordRound(
    new URL(`../${presetName}-${kind}/${roundsFileName}`, generated.directory),
    generated.hash,
  );
  const images = renders.map((render, index) => ({
    path: fileURLToPath(render),
    name: `render-${String(index + 1)}${extname(render.pathname)}`,
  }));
  const brief = heroPropBrief(
    await readFile(promptUrl, "utf8"),
    kind,
    recipe,
    preset.surfaces,
    images.map((image) => image.name),
  );
  const answer = await askHeadlessReviewer({
    reviewer: "hero-prop",
    schema: heroPropAnswerSchema,
    images,
    brief,
    timeoutMs: config.heroPropReviewTimeoutMs,
  });
  const review = reviewFromAnswer(generated.hash, answer);
  await writeFile(new URL(reviewFileName, generated.directory), JSON.stringify(review, null, 2));
  return review;
}
