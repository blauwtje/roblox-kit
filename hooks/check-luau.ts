import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

export interface ToolRun {
  status: number | null;
  output: string;
  spawnError: string | undefined;
}

export type ToolRunner = (tool: string, args: string[], cwd: string) => ToolRun;

export interface HookResult {
  exitCode: 0 | 2;
  stderr: string;
}

const checks = [
  { tool: "stylua", configNames: ["stylua.toml", ".stylua.toml"] },
  { tool: "selene", configNames: ["selene.toml"] },
];

// A Rokit shim that cannot resolve its tool exits 1 with a line such as
// "ERROR Failed to find tool 'stylua' in any project manifest file". StyLua and
// Selene print their own errors in lowercase, so this prefix marks a tool that never started.
const rokitErrorPrefix = "ERROR ";

export function findConfigFolder(startFolder: string, names: string[]): string | undefined {
  let folder = startFolder;
  for (;;) {
    if (names.some((name) => existsSync(path.join(folder, name)))) return folder;
    const parent = path.dirname(folder);
    if (parent === folder) return undefined;
    folder = parent;
  }
}

export const runTool: ToolRunner = (tool, args, cwd) => {
  const result = spawnSync(tool, args, { cwd, encoding: "utf8" });
  const error: NodeJS.ErrnoException | undefined = result.error;
  const spawnError = error?.code === "ENOENT" ? "not found on PATH" : error?.message;
  return { status: result.status, output: `${result.stdout}${result.stderr}`, spawnError };
};

function startFailure(toolRun: ToolRun): string | undefined {
  if (toolRun.spawnError !== undefined) return toolRun.spawnError;
  if (toolRun.status === 0) return undefined;
  const firstLine = stripVTControlCharacters(toolRun.output).trimStart().split("\n")[0] ?? "";
  if (!firstLine.startsWith(rokitErrorPrefix)) return undefined;
  return firstLine.slice(rokitErrorPrefix.length).trim();
}

export function checkLuauFile(filePath: string, run: ToolRunner = runTool): HookResult {
  const absolutePath = path.resolve(filePath);
  if (!absolutePath.endsWith(".luau") || !existsSync(absolutePath)) {
    return { exitCode: 0, stderr: "" };
  }

  const fileFolder = path.dirname(absolutePath);
  let skipNotes = "";
  for (const { tool, configNames } of checks) {
    const configFolder = findConfigFolder(fileFolder, configNames);
    if (configFolder === undefined) continue;
    const toolRun = run(tool, [absolutePath], configFolder);
    const failure = startFailure(toolRun);
    if (failure !== undefined) {
      skipNotes += `${tool} skipped: ${failure}\n`;
      continue;
    }
    if (toolRun.status !== 0) return { exitCode: 2, stderr: `${skipNotes}${toolRun.output}` };
  }
  return { exitCode: 0, stderr: skipNotes };
}

export function filePathFromInput(stdinText: string): string | undefined {
  let input: unknown;
  try {
    input = JSON.parse(stdinText);
  } catch {
    return undefined;
  }
  const toolInput = (input as { tool_input?: { file_path?: unknown } } | null)?.tool_input;
  return typeof toolInput?.file_path === "string" ? toolInput.file_path : undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const filePath = filePathFromInput(readFileSync(0, "utf8"));
  const result = filePath === undefined ? { exitCode: 0, stderr: "" } : checkLuauFile(filePath);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
