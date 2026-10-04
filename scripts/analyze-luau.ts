import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { config } from "../src/config.ts";
import { profileStorePath } from "./profilestore-cache.ts";

/**
 * `node scripts/analyze-luau.ts` type-checks `luau/` with `luau-lsp analyze` against Roblox's type definitions at plugin security, the level `execute_luau` runs at.
 * It then type-checks `skills/data/templates/` against the pinned ProfileStore through a generated sourcemap, so a wrong ProfileStore API name in a template fails.
 * The definitions come from the luau-lsp tag that `rokit.toml` pins and are cached in the git-ignored
 * `.roblox-kit/cache/`; bumping the pin downloads the definitions for the new tag.
 */
const rokitToml = readFileSync("rokit.toml", "utf8");
const luauLspVersion = /^luau-lsp\s*=\s*"JohnnyMorganz\/luau-lsp@([^"]+)"/m.exec(rokitToml)?.[1];
if (luauLspVersion === undefined) {
  throw new Error("rokit.toml has no luau-lsp entry of the form JohnnyMorganz/luau-lsp@<version>.");
}
const definitionsUrl = `https://raw.githubusercontent.com/JohnnyMorganz/luau-lsp/${luauLspVersion}/scripts/globalTypes.PluginSecurity.d.luau`;
const cacheDirectory = config.profileStoreCacheFolder;
const definitionsPath = join(cacheDirectory, `globalTypes.PluginSecurity.${luauLspVersion}.d.luau`);

if (!existsSync(definitionsPath)) {
  const response = await fetch(definitionsUrl);
  if (!response.ok) {
    throw new Error(`Downloading ${definitionsUrl} failed: HTTP ${String(response.status)}`);
  }
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(definitionsPath, await response.text());
}

function analyze(extraArguments: string[], target: string): number {
  const result = spawnSync(
    "luau-lsp",
    ["analyze", `--definitions=${definitionsPath}`, ...extraArguments, target],
    { stdio: "inherit" },
  );
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

const luauStatus = analyze([], "luau");

// The templates require ProfileStore at ServerScriptService.ServerPackages.ProfileStore and each other as siblings.
// The sourcemap places the downloaded ProfileStore there, and the templates in a Data folder under ServerScriptService.
const templatesDirectory = join("skills", "data", "templates");
const templateModules = readdirSync(templatesDirectory)
  .filter((fileName) => fileName.endsWith(".luau"))
  .map((fileName) => ({
    name: fileName.replace(/(\.server)?\.luau$/, ""),
    className: fileName.endsWith(".server.luau") ? "Script" : "ModuleScript",
    filePaths: [join(templatesDirectory, fileName)],
  }));
const sourcemap = {
  name: "Game",
  className: "DataModel",
  children: [
    {
      name: "ServerScriptService",
      className: "ServerScriptService",
      children: [
        {
          name: "ServerPackages",
          className: "Folder",
          children: [
            {
              name: "ProfileStore",
              className: "ModuleScript",
              filePaths: [relative(process.cwd(), await profileStorePath())],
            },
          ],
        },
        { name: "Data", className: "Folder", children: templateModules },
      ],
    },
  ],
};
const sourcemapPath = join(cacheDirectory, "data-templates-sourcemap.json");
await writeFile(sourcemapPath, JSON.stringify(sourcemap, null, 2));

// ProfileStore's own file is third-party code; only the templates' diagnostics count.
const templatesStatus = analyze(
  [`--sourcemap=${sourcemapPath}`, `--ignore=**/${cacheDirectory}/**`],
  templatesDirectory,
);
process.exit(luauStatus === 0 ? templatesStatus : luauStatus);
