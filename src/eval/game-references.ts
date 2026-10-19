import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const gameReferencesUrl = new URL("../../eval/game-references.json", import.meta.url);
const gameReferencesFolderUrl = new URL("../../eval/references/games/", import.meta.url);

const gameReferencesSchema = z.array(
  z.strictObject({
    game: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    formula: z.string().min(1),
    references: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          universeId: z.number().int().positive(),
          placeId: z.number().int().positive(),
          images: z.number().int().min(1).max(10),
        }),
      )
      .min(1),
  }),
);

export type GameReferences = z.infer<typeof gameReferencesSchema>[number];
export type GameReference = GameReferences["references"][number];

export function parseGameReferences(text: string): GameReferences[] {
  const parsed = gameReferencesSchema.parse(JSON.parse(text));
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (seen.has(entry.game)) throw new Error(`Game ${entry.game} is listed twice.`);
    seen.add(entry.game);
  }
  return parsed;
}

export async function readGameReferences(): Promise<GameReferences[]> {
  return parseGameReferences(await readFile(gameReferencesUrl, "utf8"));
}

/** Where the fetched image `index` (1-based) of a reference game is stored. */
export function gameReferenceImagePath(
  game: string,
  reference: GameReference,
  index: number,
): string {
  return fileURLToPath(
    new URL(
      `${game}/${String(reference.universeId)}-${String(index)}.png`,
      gameReferencesFolderUrl,
    ),
  );
}

/** Every image path a game's reference list expects on disk. */
export function gameReferenceImagePaths(entry: GameReferences): string[] {
  return entry.references.flatMap((reference) =>
    Array.from({ length: reference.images }, (_, index) =>
      gameReferenceImagePath(entry.game, reference, index + 1),
    ),
  );
}

interface ThumbnailLike {
  state: string;
  imageUrl: string | null;
}

/** The first `count` completed thumbnail URLs, in API order. */
export function completedImageUrls(thumbnails: ThumbnailLike[], count: number): string[] {
  const urls: string[] = [];
  for (const thumbnail of thumbnails) {
    if (thumbnail.state === "Completed" && thumbnail.imageUrl !== null)
      urls.push(thumbnail.imageUrl);
    if (urls.length === count) break;
  }
  return urls;
}

/**
 * At most `limit` image paths, taken round-robin across the reference games (each game's first image, then
 * each game's second, and so on) so no single game dominates the reviewer's references.
 */
export function pickReferenceImages(perGame: string[][], limit: number): string[] {
  const picked: string[] = [];
  const deepest = Math.max(0, ...perGame.map((paths) => paths.length));
  for (let depth = 0; depth < deepest; depth += 1) {
    for (const paths of perGame) {
      const path = paths[depth];
      if (path !== undefined && picked.length < limit) picked.push(path);
    }
  }
  return picked;
}
