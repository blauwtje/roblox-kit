import { execFile } from "node:child_process";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "../src/config.ts";

/**
 * Downloads the pinned ProfileStore from Wally once into `.roblox-kit/cache/profilestore-<version>/` and returns the
 * path of its `ProfileStore.luau`. The folder is git-ignored: ProfileStore (Apache-2.0) is never committed.
 */
const runFile = promisify(execFile);
const repositoryRoot = new URL("../", import.meta.url);

export async function profileStorePath(): Promise<string> {
  const folder = new URL(
    `${config.profileStoreCacheFolder}/profilestore-${config.profileStoreVersion}/`,
    repositoryRoot,
  );
  const sourcePath = fileURLToPath(new URL("ProfileStore.luau", folder));
  const exists = await access(sourcePath).then(
    () => true,
    () => false,
  );
  if (exists) return sourcePath;

  const url = `${config.wallyPackageContentsUrl}${config.profileStorePackage}/${config.profileStoreVersion}`;
  const response = await fetch(url, {
    headers: { "Wally-Version": config.wallyClientVersion },
    signal: AbortSignal.timeout(config.upstreamTimeoutMs),
  });
  if (!response.ok) throw new Error(`Downloading ${url} failed: HTTP ${String(response.status)}`);

  // Unpack beside the final folder, then rename, so an interrupted run never leaves a folder that looks complete.
  const partial = new URL(`${folder.href.slice(0, -1)}.partial/`);
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  const zipPath = fileURLToPath(new URL("package.zip", partial));
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  await runFile("unzip", ["-q", zipPath, "-d", fileURLToPath(partial)]);
  await rm(zipPath);
  await rm(folder, { recursive: true, force: true });
  await rename(partial, folder);

  const found = await access(sourcePath).then(
    () => true,
    () => false,
  );
  if (!found)
    throw new Error(
      `The ${config.profileStorePackage} ${config.profileStoreVersion} zip has no ProfileStore.luau`,
    );
  return sourcePath;
}
