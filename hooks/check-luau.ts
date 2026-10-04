import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ToolRun {
  status: number | null;
  output: string;
  missing: boolean;
}

export type ToolRunner = (tool: string, args: string[], cwd: string) => ToolRun;

export interface HookResult {
  exitCode: 0 | 2;
  stderr: string;
}

const stylerConfigNames = ["stylua.toml", ".stylua.toml"];
const linterConfigNames = ["selene.toml"];

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
  const missing = error?.code === "ENOENT";
  return { status: result.status, output: `${result.stdout}${result.stderr}`, missing };
};

export function checkLuauFile(filePath: string, run: ToolRunner = runTool): HookResult {
  const passed: HookResult = { exitCode: 0, stderr: "" };
  const absolutePath = path.resolve(filePath);
  if (!absolutePath.endsWith(".luau") || !existsSync(absolutePath)) return passed;

  const fileFolder = path.dirname(absolutePath);
  const styleFolder = findConfigFolder(fileFolder, stylerConfigNames);
  if (styleFolder !== undefined) run("stylua", [absolutePath], styleFolder);

  const lintFolder = findConfigFolder(fileFolder, linterConfigNames);
  if (lintFolder === undefined) return passed;
  const lint = run("selene", [absolutePath], lintFolder);
  if (lint.missing || lint.status === 0) return passed;
  return { exitCode: 2, stderr: lint.output };
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
