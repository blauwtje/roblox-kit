import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { z } from "zod";
import { readReferenceSet, referenceImagePath, type Reference } from "../src/eval/reference-set.ts";
import {
  completedImageUrls,
  gameReferenceImagePath,
  readGameReferences,
} from "../src/eval/game-references.ts";
import { runScript } from "./lib/run-script.ts";

/**
 * `node scripts/fetch-references.ts` downloads every image `eval/reference-set.json` names into
 * `eval/references/<game>/<targetId>.png` (768x432, no overlay), where `<game>` is the game's name in kebab-case.
 * The folder is git-ignored. A listed targetId the thumbnail API no longer returns fails the run by name,
 * after every returned image is written.
 */
const thumbnailsEndpoint = "https://thumbnails.roblox.com/v1/games/multiget/thumbnails";
/** The API returns at most this many thumbnails per universe. */
const thumbnailsPerUniverse = 50;

const thumbnailResponseSchema = z.object({
  data: z.array(
    z.object({
      universeId: z.number().int(),
      error: z.unknown(),
      thumbnails: z.array(
        z.object({
          targetId: z.number().int(),
          state: z.string(),
          imageUrl: z.string().nullable(),
        }),
      ),
    }),
  ),
});

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} answered ${String(response.status)} ${response.statusText}`);
  }
  return response;
}

/** Maps each target ID the API returns for the universes to its image URL. */
async function imageUrlsByTargetId(universeIds: number[]): Promise<Map<number, string>> {
  const query = new URLSearchParams({
    universeIds: universeIds.join(","),
    countPerUniverse: String(thumbnailsPerUniverse),
    size: "768x432",
    format: "Png",
    defaultOverlay: "false",
  });
  const response = await fetchOk(`${thumbnailsEndpoint}?${query.toString()}`);
  const parsed = thumbnailResponseSchema.parse(await response.json());
  const urls = new Map<number, string>();
  for (const universe of parsed.data) {
    for (const thumbnail of universe.thumbnails) {
      if (thumbnail.state === "Completed" && thumbnail.imageUrl !== null) {
        urls.set(thumbnail.targetId, thumbnail.imageUrl);
      }
    }
  }
  return urls;
}

async function download(reference: Reference, imageUrl: string): Promise<string> {
  const imagePath = referenceImagePath(reference);
  await mkdir(dirname(imagePath), { recursive: true });
  const response = await fetchOk(imageUrl);
  await writeFile(imagePath, Buffer.from(await response.arrayBuffer()));
  return relative(process.cwd(), imagePath);
}

/**
 * Downloads the in-game screenshots `eval/game-references.json` lists into
 * `eval/references/games/<game>/<universeId>-<n>.png`. A universe with fewer completed screenshots than listed fails the run by name.
 */
async function fetchGameReferences(): Promise<number> {
  const games = await readGameReferences();
  const universeIds = [
    ...new Set(games.flatMap((entry) => entry.references.map((reference) => reference.universeId))),
  ];
  const query = new URLSearchParams({
    universeIds: universeIds.join(","),
    countPerUniverse: "10",
    size: "768x432",
    format: "Png",
    defaultOverlay: "false",
  });
  const response = await fetchOk(`${thumbnailsEndpoint}?${query.toString()}`);
  const parsed = thumbnailResponseSchema.parse(await response.json());
  const short: string[] = [];
  let written = 0;
  for (const entry of games) {
    for (const reference of entry.references) {
      const thumbnails =
        parsed.data.find((universe) => universe.universeId === reference.universeId)?.thumbnails ??
        [];
      const urls = completedImageUrls(thumbnails, reference.images);
      if (urls.length < reference.images) {
        short.push(
          `${reference.name} (${String(reference.universeId)}): ${String(urls.length)} of ${String(reference.images)}`,
        );
      }
      for (const [index, imageUrl] of urls.entries()) {
        const imagePath = gameReferenceImagePath(entry.game, reference, index + 1);
        await mkdir(dirname(imagePath), { recursive: true });
        await writeFile(imagePath, Buffer.from(await (await fetchOk(imageUrl)).arrayBuffer()));
        console.log(`fetched ${relative(process.cwd(), imagePath)}`);
        written += 1;
      }
    }
  }
  console.log(`${String(written)} game reference images`);
  if (short.length > 0) throw new Error(`Too few screenshots:\n${short.join("\n")}`);
  return 0;
}

async function fetchReferences(): Promise<number> {
  const references = await readReferenceSet();
  const universeIds = [...new Set(references.map((reference) => reference.universeId))];
  const imageUrls = await imageUrlsByTargetId(universeIds);
  const missing: string[] = [];
  for (const reference of references) {
    const imageUrl = imageUrls.get(reference.targetId);
    if (imageUrl === undefined) {
      missing.push(`${reference.game} ${String(reference.targetId)}`);
      continue;
    }
    console.log(`fetched ${await download(reference, imageUrl)}`);
  }
  if (missing.length > 0) {
    throw new Error(`The thumbnail API no longer returns:\n${missing.join("\n")}`);
  }
  return 0;
}

await runScript({
  name: "fetch-references",
  usage:
    "Usage: node scripts/fetch-references.ts [--games]\nDownloads every image eval/reference-set.json names into eval/references/.\n--games downloads the in-game screenshots eval/game-references.json lists into eval/references/games/ instead.",
  options: { games: { type: "boolean" } },
  run: (values) => (values.games === true ? fetchGameReferences() : fetchReferences()),
});
