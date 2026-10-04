import { createHash } from "node:crypto";

/** Hex characters of the SHA-256 kept in an output folder name. */
const HASH_HEX_CHARACTERS = 12;

/** JSON with every object's keys sorted, so key order never changes a hash. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The short SHA-256 of a resolved recipe and the generator's source, so a change to either names a new output. */
export function recipeHash(resolvedRecipe: unknown, generatorSource: string): string {
  const hash = createHash("sha256");
  hash.update(canonicalJson(resolvedRecipe));
  hash.update("\0");
  hash.update(generatorSource);
  return hash.digest("hex").slice(0, HASH_HEX_CHARACTERS);
}
