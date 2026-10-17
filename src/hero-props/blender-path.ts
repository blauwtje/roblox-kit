import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { heroConfig } from "./hero-config.ts";

const execFileAsync = promisify(execFile);
const blenderBufferBytes = 10 * 1024 * 1024;
const errorLogLines = 20;

export type BlenderExec = (
  file: string,
  args: string[],
  options: {
    timeout: number;
    maxBuffer: number;
    env: Record<string, string | undefined>;
  },
) => Promise<unknown>;

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolves the Blender executable: `BLENDER_PATH` when set, else the first of `heroConfig.blenderFallbackPaths` that exists (a bare name is looked up on `env.PATH`). Throws when none is found. */
export function blenderPath(
  env: Record<string, string | undefined>,
  exists: (file: string) => boolean = isExecutable,
): string {
  const fromEnv = env[heroConfig.blenderPathEnv];
  if (fromEnv) return fromEnv;
  const directories = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const candidate of heroConfig.blenderFallbackPaths) {
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
    `Blender not found: set ${heroConfig.blenderPathEnv}, or install it at one of ${heroConfig.blenderFallbackPaths.join(", ")}.`,
  );
}

function blenderEnvironment(): Record<string, string | undefined> {
  return {
    ...process.env,
    [heroConfig.blenderDeviceEnv]: process.env[heroConfig.blenderDeviceEnv],
  };
}

/** Runs `script` with headless Blender, passing `args` after `--`; a failure throws an error naming the script with the last 20 stderr lines. */
export async function runBlender(
  script: string,
  args: string[],
  exec: BlenderExec = execFileAsync,
): Promise<void> {
  try {
    await exec(
      blenderPath(process.env),
      ["-b", "--factory-startup", "--python-exit-code", "1", "-P", script, "--", ...args],
      {
        timeout: heroConfig.blenderTimeoutMs,
        maxBuffer: blenderBufferBytes,
        env: blenderEnvironment(),
      },
    );
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const tail =
      typeof stderr === "string" ? stderr.trimEnd().split("\n").slice(-errorLogLines) : [];
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Blender failed running ${script}: ${reason}\n${tail.join("\n")}`.trimEnd(), {
      cause: error,
    });
  }
}
