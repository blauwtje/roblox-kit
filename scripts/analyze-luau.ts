import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * `node scripts/analyze-luau.ts` type-checks `luau/` with `luau-lsp analyze` against Roblox's type definitions at plugin security, the level `execute_luau` runs at.
 * The definitions come from the luau-lsp tag that `rokit.toml` pins and are cached in the git-ignored
 * `.roblox-kit/cache/`; bumping the pin downloads the definitions for the new tag.
 */
const rokitToml = readFileSync("rokit.toml", "utf8");
const luauLspVersion = /^luau-lsp\s*=\s*"JohnnyMorganz\/luau-lsp@([^"]+)"/m.exec(rokitToml)?.[1];
if (luauLspVersion === undefined) {
  throw new Error("rokit.toml has no luau-lsp entry of the form JohnnyMorganz/luau-lsp@<version>.");
}
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
