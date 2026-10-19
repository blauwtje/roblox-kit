import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { scriptConfig } from "../src/studio/script-config.ts";
import { runScript } from "./lib/run-script.ts";
import { profileStorePath } from "./profilestore-cache.ts";

/**
 * `node scripts/analyze-luau.ts` type-checks `luau/` with `luau-lsp analyze` against Roblox's type definitions at plugin security, the level `execute_luau` runs at.
 * It then type-checks `skills/data/templates/` against the pinned ProfileStore through a generated sourcemap, so a wrong ProfileStore API name in a template fails.
 * Last, it type-checks `skills/networking/templates/` through a sourcemap placing the generated Blink files at
 * `ServerScriptService.Network` and `ReplicatedStorage.Network`, where the game's Rojo project maps them.
 * It also type-checks all of `skills/game-formula/templates/` through a sourcemap placing each file where `scripts/smoke-games.ts` inserts it.
 * The definitions come from the luau-lsp tag that `rokit.toml` pins and are cached in the git-ignored
 * `.roblox-kit/cache/`; bumping the pin downloads the definitions for the new tag.
 */
const cacheDirectory = scriptConfig.profileStoreCacheFolder;

async function downloadDefinitions(): Promise<string> {
  const rokitToml = readFileSync("rokit.toml", "utf8");
  const luauLspVersion = /^luau-lsp\s*=\s*"JohnnyMorganz\/luau-lsp@([^"]+)"/m.exec(rokitToml)?.[1];
  if (luauLspVersion === undefined) {
    throw new Error(
      "rokit.toml has no luau-lsp entry of the form JohnnyMorganz/luau-lsp@<version>.",
    );
  }
  const definitionsUrl = `https://raw.githubusercontent.com/JohnnyMorganz/luau-lsp/${luauLspVersion}/scripts/globalTypes.PluginSecurity.d.luau`;
  const definitionsPath = join(
    cacheDirectory,
    `globalTypes.PluginSecurity.${luauLspVersion}.d.luau`,
  );
  if (!existsSync(definitionsPath)) {
    const response = await fetch(definitionsUrl);
    if (!response.ok) {
      throw new Error(`Downloading ${definitionsUrl} failed: HTTP ${String(response.status)}`);
    }
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(definitionsPath, await response.text());
  }
  return definitionsPath;
}

function analyze(definitionsPath: string, extraArguments: string[], target: string): number {
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

function moduleEntries(directory: string) {
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".luau"))
    .map((fileName) => ({
      name: fileName.replace(/(\.server)?\.luau$/, ""),
      className: fileName.endsWith(".server.luau") ? "Script" : "ModuleScript",
      filePaths: [join(directory, fileName)],
    }));
}

async function analyzeDataTemplates(definitionsPath: string): Promise<number> {
  const templatesDirectory = join("skills", "data", "templates");
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
          { name: "Data", className: "Folder", children: moduleEntries(templatesDirectory) },
        ],
      },
    ],
  };
  const sourcemapPath = join(cacheDirectory, "data-templates-sourcemap.json");
  await writeFile(sourcemapPath, JSON.stringify(sourcemap, null, 2));

  return analyze(
    definitionsPath,
    [`--sourcemap=${sourcemapPath}`, `--ignore=**/${cacheDirectory}/**`],
    templatesDirectory,
  );
}

async function analyzeNetworkingTemplates(definitionsPath: string): Promise<number> {
  const networkingDirectory = join("skills", "networking", "templates");
  const generatedDirectory = join(networkingDirectory, "network", "generated");
  const networkingSourcemap = {
    name: "Game",
    className: "DataModel",
    children: [
      {
        name: "ServerScriptService",
        className: "ServerScriptService",
        children: [
          {
            name: "Network",
            className: "ModuleScript",
            filePaths: [join(generatedDirectory, "Server.luau")],
          },
          {
            name: "NetworkTemplates",
            className: "Folder",
            children: moduleEntries(networkingDirectory),
          },
        ],
      },
      {
        name: "ReplicatedStorage",
        className: "ReplicatedStorage",
        children: [
          {
            name: "Network",
            className: "ModuleScript",
            filePaths: [join(generatedDirectory, "Client.luau")],
          },
        ],
      },
    ],
  };
  const networkingSourcemapPath = join(cacheDirectory, "networking-templates-sourcemap.json");
  await writeFile(networkingSourcemapPath, JSON.stringify(networkingSourcemap, null, 2));
  return analyze(
    definitionsPath,
    [`--sourcemap=${networkingSourcemapPath}`, "--ignore=**/network/generated/**"],
    networkingDirectory,
  );
}

/** Sourcemap entries for one game-formula template folder, placed as `scripts/smoke-games.ts` inserts them. */
function gameFormulaEntries(directory: string, container: string) {
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".luau") && fileName !== "Checks.luau")
    .map((fileName) => {
      const isClient = fileName.endsWith(".client.luau");
      const isServer = fileName.endsWith(".server.luau");
      const name = fileName.replace(/(\.server|\.client)?\.luau$/, "");
      const parent = isClient
        ? "StarterPlayerScripts"
        : isServer || name !== "GameFormulaJuice"
          ? "ServerScriptService"
          : "ReplicatedStorage";
      return {
        parent,
        entry: {
          name,
          className: isClient ? "LocalScript" : isServer ? "Script" : "ModuleScript",
          filePaths: [join(directory, fileName)],
        },
      };
    })
    .filter(({ parent }) => parent === container)
    .map(({ entry }) => entry);
}

async function analyzeGameFormulaTemplates(definitionsPath: string): Promise<number> {
  const templatesDirectory = join("skills", "game-formula", "templates");
  const folders = readdirSync(templatesDirectory).map((folder) => join(templatesDirectory, folder));
  const entriesIn = (container: string) =>
    folders.flatMap((folder) => gameFormulaEntries(folder, container));
  const sourcemap = {
    name: "Game",
    className: "DataModel",
    children: [
      {
        name: "ReplicatedStorage",
        className: "ReplicatedStorage",
        children: entriesIn("ReplicatedStorage"),
      },
      {
        name: "ServerScriptService",
        className: "ServerScriptService",
        children: entriesIn("ServerScriptService"),
      },
      {
        name: "StarterPlayer",
        className: "StarterPlayer",
        children: [
          {
            name: "StarterPlayerScripts",
            className: "StarterPlayerScripts",
            children: entriesIn("StarterPlayerScripts"),
          },
        ],
      },
    ],
  };
  const sourcemapPath = join(cacheDirectory, "game-formula-templates-sourcemap.json");
  await writeFile(sourcemapPath, JSON.stringify(sourcemap, null, 2));
  return analyze(definitionsPath, [`--sourcemap=${sourcemapPath}`], templatesDirectory);
}

async function analyzeLuau(): Promise<number> {
  const definitionsPath = await downloadDefinitions();
  const luauStatus = analyze(definitionsPath, [], "luau");
  const templatesStatus = await analyzeDataTemplates(definitionsPath);
  const networkingStatus = await analyzeNetworkingTemplates(definitionsPath);
  const gameFormulaStatus = await analyzeGameFormulaTemplates(definitionsPath);
  return luauStatus || templatesStatus || networkingStatus || gameFormulaStatus;
}

await runScript({
  name: "analyze-luau",
  usage:
    "Usage: node scripts/analyze-luau.ts\nType-checks luau/ and the data, networking and game-formula skill templates with luau-lsp.",
  run: analyzeLuau,
});
