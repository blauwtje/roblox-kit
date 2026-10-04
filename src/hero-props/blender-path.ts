import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { config } from "../config.ts";

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolves the Blender executable: `BLENDER_PATH` when set, else the first of `config.blenderFallbackPaths` that exists (a bare name is looked up on `env.PATH`). Throws when none is found. */
export function blenderPath(
  env: Record<string, string | undefined>,
  exists: (file: string) => boolean = isExecutable,
): string {
  const fromEnv = env[config.blenderPathEnv];
  if (fromEnv) return fromEnv;
  const directories = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const candidate of config.blenderFallbackPaths) {
    if (candidate.includes("/")) {
      if (exists(candidate)) return candidate;
      continue;
    }
    for (const directory of directories) {
      const found = join(directory, candidate);
      if (exists(found)) return found;
    }
  }
  throw new Error(
    `Blender not found: set ${config.blenderPathEnv}, or install it at one of ${config.blenderFallbackPaths.join(", ")}.`,
  );
}
