import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const referenceSetUrl = new URL("../../eval/reference-set.json", import.meta.url);
const referencesUrl = new URL("../../eval/references/", import.meta.url);

const referenceSetSchema = z.array(
  z.strictObject({
    game: z.string().min(1),
    placeId: z.number().int(),
    universeId: z.number().int(),
    targetId: z.number().int(),
    version: z.string().min(1),
    note: z.string().min(1),
    preset: z.string().min(1),
  }),
);

export type Reference = z.infer<typeof referenceSetSchema>[number];

export async function readReferenceSet(): Promise<Reference[]> {
  return referenceSetSchema.parse(JSON.parse(await readFile(referenceSetUrl, "utf8")));
}

function gameFolder(game: string): string {
  return game
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

export function referenceImagePath(reference: Reference): string {
  const imageUrl = new URL(
    `${gameFolder(reference.game)}/${String(reference.targetId)}.png`,
    referencesUrl,
  );
  return fileURLToPath(imageUrl);
}
