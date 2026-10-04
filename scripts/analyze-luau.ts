import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * `node scripts/analyze-luau.ts` type-checks `luau/` with `luau-lsp analyze` against Roblox's type definitions at plugin security, the level `execute_luau` runs at.
 * The definitions come from the luau-lsp tag that `rokit.toml` pins and are cached in the git-ignored
 * `.roblox-kit/cache/`; delete the cached file to download them again after bumping the pin.
 */
const luauLspVersion = "1.70.1";
const definitionsUrl = `https://raw.githubusercontent.com/JohnnyMorganz/luau-lsp/${luauLspVersion}/scripts/globalTypes.PluginSecurity.d.luau`;
const cacheDirectory = join(".roblox-kit", "cache");
const definitionsPath = join(cacheDirectory, `globalTypes.PluginSecurity.${luauLspVersion}.d.luau`);

if (!existsSync(definitionsPath)) {
  const response = await fetch(definitionsUrl);
  if (!response.ok) {
    throw new Error(`Downloading ${definitionsUrl} failed: HTTP ${String(response.status)}`);
  }
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(definitionsPath, await response.text());
}

const result = spawnSync("luau-lsp", ["analyze", `--definitions=${definitionsPath}`, "luau"], {
  stdio: "inherit",
});
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
