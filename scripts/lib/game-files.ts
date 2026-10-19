/**
 * Where each file of a `game-formula` template goes in the open place, by file name suffix:
 * `*.client.luau` is a LocalScript in StarterPlayer.StarterPlayerScripts, `*.server.luau` a Script in
 * ServerScriptService, `Checks.luau` is not inserted (it is the serverChecks body of the playtest), and any
 * other `*.luau` is a ModuleScript: `GameFormulaJuice` in ReplicatedStorage, the rest in ServerScriptService.
 */
export interface GameFilePlacement {
  name: string;
  className: "LocalScript" | "Script" | "ModuleScript";
  /** Luau expression for the instance to insert into. */
  parent: string;
  /** The service the parent sits under, for cleanup and preflight. */
  container: "ReplicatedStorage" | "ServerScriptService" | "StarterPlayerScripts";
}

export const checksFileName = "Checks.luau";
const sharedModuleName = "GameFormulaJuice";

const parents = {
  ReplicatedStorage: `game:GetService("ReplicatedStorage")`,
  ServerScriptService: `game:GetService("ServerScriptService")`,
  StarterPlayerScripts: `game:GetService("StarterPlayer"):FindFirstChild("StarterPlayerScripts")`,
} as const;

/** Returns where a template file goes, or undefined for `Checks.luau`. Throws for anything that is not a `.luau` file. */
export function classifyGameFile(fileName: string): GameFilePlacement | undefined {
  if (fileName === checksFileName) return undefined;
  if (!fileName.endsWith(".luau") || fileName.length <= ".luau".length) {
    throw new Error(`${fileName} is not a .luau file.`);
  }
  const stem = fileName.slice(0, -".luau".length);
  if (stem.endsWith(".client")) {
    return place(stem.slice(0, -".client".length), "LocalScript", "StarterPlayerScripts");
  }
  if (stem.endsWith(".server")) {
    return place(stem.slice(0, -".server".length), "Script", "ServerScriptService");
  }
  return place(
    stem,
    "ModuleScript",
    stem === sharedModuleName ? "ReplicatedStorage" : "ServerScriptService",
  );
}

function place(
  name: string,
  className: GameFilePlacement["className"],
  container: GameFilePlacement["container"],
): GameFilePlacement {
  if (name === "") throw new Error(`A script file needs a name before its suffix.`);
  return { name, className, parent: parents[container], container };
}
