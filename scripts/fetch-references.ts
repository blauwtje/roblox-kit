import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { z } from "zod";
import { readReferenceSet, referenceImagePath, type Reference } from "../src/eval/reference-set.ts";

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

try {
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
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
