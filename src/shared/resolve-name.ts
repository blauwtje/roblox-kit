function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "-");
}

/**
 * Returns the key of `known` that `given` names: the exact key first, else the one key equal after
 * lower-casing, trimming and turning runs of spaces and hyphens into one hyphen. Throws
 * `Unknown <label> "<given>"` listing every valid name when none or several match.
 */
export function resolveName(given: string, known: Iterable<string>, label: string): string {
  const keys = [...known];
  if (keys.includes(given)) {
    return given;
  }
  const wanted = normalize(given);
  const matches = keys.filter((key) => normalize(key) === wanted);
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) {
    return only;
  }
  const why = matches.length > 1 ? ` (it matches ${matches.join(" and ")})` : "";
  throw new Error(`Unknown ${label} "${given}"${why}; the valid names are: ${keys.join(", ")}`);
}
