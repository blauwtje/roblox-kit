import { appendFile, readdir } from "node:fs/promises";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evalConfig } from "../src/eval/eval-config.ts";
import {
  gameReferenceImagePaths,
  pickReferenceImages,
  readGameReferences,
  type GameReferences,
} from "../src/eval/game-references.ts";
import { qualityAxes, reviewQuality } from "../src/eval/quality-review.ts";
import { runScript } from "./lib/run-script.ts";

/**
 * Sends each game's real reference screenshots (`node scripts/fetch-references.ts --games`) and the shots
 * `npm run smoke:games` captured to `evalConfig.qualityReviewersPerRoom` fresh headless reviewers, prints the
 * per-axis medians against `evalConfig.visualPassScore` and appends one line per game to `eval/game-results.jsonl`.
 */
const shotsFolder = fileURLToPath(new URL("../.roblox-kit/game-shots/", import.meta.url));
const resultsUrl = new URL("../eval/game-results.jsonl", import.meta.url);
/** The reviewer sees at most this many reference images, spread over the reference games. */
const maxReferenceImages = 6;
const roomType = "game scene";
const lightingIntent =
  "Bright, saturated, readable daylight: a front-page Roblox game scene whose key objects and the path to the goal read at a glance.";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function shotPaths(game: string): Promise<string[]> {
  const folder = join(shotsFolder, game);
  const names = (await readdir(folder).catch(() => [])).filter((name) =>
    /^shot-\d+\.(png|jpg)$/.test(name),
  );
  return names.toSorted().map((name) => join(folder, name));
}

async function proveGame(entry: GameReferences): Promise<boolean> {
  const shots = await shotPaths(entry.game);
  if (shots.length === 0) {
    throw new Error(`No shots for ${entry.game}: run npm run smoke:games -- --only ${entry.game}`);
  }
  const perGame = await Promise.all(
    entry.references.map(async (reference) => {
      const paths = gameReferenceImagePaths({ ...entry, references: [reference] });
      return (
        await Promise.all(paths.map(async (path) => ((await exists(path)) ? path : "")))
      ).filter((path) => path !== "");
    }),
  );
  const references = pickReferenceImages(perGame, maxReferenceImages);
  if (references.length === 0) {
    throw new Error("No reference images: run node scripts/fetch-references.ts --games");
  }
  console.log(
    `${entry.game}: ${String(references.length)} references, ${String(shots.length)} shots`,
  );
  const result = await reviewQuality(
    entry.game,
    entry.formula,
    roomType,
    lightingIntent,
    references,
    shots,
  );
  if (result.medians !== undefined) {
    for (const axis of qualityAxes) {
      const score = result.medians[axis];
      console.log(
        `  ${axis}: ${String(score)} ${score >= evalConfig.visualPassScore ? "pass" : "FAIL"}`,
      );
    }
  }
  if (result.error !== undefined) console.log(`  error: ${result.error}`);
  console.log(
    `${entry.game}: ${result.passed ? "PASS" : "FAIL"} (axis floor ${String(evalConfig.visualPassScore)})`,
  );
  await appendFile(
    resultsUrl,
    `${JSON.stringify({
      game: entry.game,
      ranAt: new Date().toISOString(),
      passScore: evalConfig.visualPassScore,
      reviewers: evalConfig.qualityReviewersPerRoom,
      referenceImages: references.length,
      shots: shots.length,
      medians: result.medians,
      evidence: result.evidence,
      error: result.error,
      passed: result.passed,
    })}\n`,
  );
  return result.passed;
}

await runScript({
  name: "prove-games",
  usage: `Usage: node scripts/prove-games.ts [--only <game>]
Scores .roblox-kit/game-shots/<game>/ against eval/references/games/<game>/ with fresh headless reviewers
and appends a line per game to eval/game-results.jsonl. Exits 1 when any game misses the pass score.`,
  options: { only: { type: "string" } },
  run: async (values) => {
    const games = (await readGameReferences()).filter(
      (entry) => typeof values.only !== "string" || entry.game === values.only,
    );
    if (games.length === 0) throw new Error(`No game matches --only ${String(values.only)}.`);
    let allPassed = true;
    for (const entry of games) {
      if (!(await proveGame(entry))) allPassed = false;
    }
    return allPassed ? 0 : 1;
  },
});
