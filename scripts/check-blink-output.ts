import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `node scripts/check-blink-output.ts` regenerates the networking template's Blink output in a temporary folder
 * with the `blink` that `rokit.toml` pins and fails when a generated file differs byte for byte from the committed one.
 * Blink 0.18.9 waits on a terminal prompt without a TTY, so it runs with `--yes` and stdin closed.
 */
const templateFolder = join("skills", "networking", "templates", "network");
const committedFolder = join(templateFolder, "generated");
const temporaryFolder = mkdtempSync(join(tmpdir(), "blink-output-"));

try {
  copyFileSync(join(templateFolder, "game.blink"), join(temporaryFolder, "game.blink"));
  // The Rokit shim finds the pinned blink through a manifest in or above its working directory.
  copyFileSync("rokit.toml", join(temporaryFolder, "rokit.toml"));
  mkdirSync(join(temporaryFolder, "generated"));
  const result = spawnSync("blink", ["game.blink", "--yes"], {
    cwd: temporaryFolder,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`blink exited with status ${String(result.status)}.`);
  }

  const regenerated = readdirSync(join(temporaryFolder, "generated")).sort();
  const committed = readdirSync(committedFolder).sort();
  const names = [...new Set([...regenerated, ...committed])].sort();
  const drifted = names.filter((name) => {
    if (!regenerated.includes(name) || !committed.includes(name)) {
      return true;
    }
    const fresh = readFileSync(join(temporaryFolder, "generated", name));
    return !fresh.equals(readFileSync(join(committedFolder, name)));
  });
  if (drifted.length > 0) {
    console.error(
      `Committed Blink output differs from a fresh run: ${drifted.join(", ")}. Regenerate it with blink; never edit it by hand.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Blink output matches: ${names.join(", ")}.`);
  }
} finally {
  rmSync(temporaryFolder, { recursive: true, force: true });
}
