import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkLuauFile, filePathFromInput, type ToolRunner } from "./check-luau.ts";

interface Call {
  tool: string;
  cwd: string;
}

function makeProject(configNames: string[]): { file: string; folder: string } {
  const folder = mkdtempSync(path.join(tmpdir(), "check-luau-"));
  for (const name of configNames) writeFileSync(path.join(folder, name), "");
  mkdirSync(path.join(folder, "luau"));
  const file = path.join(folder, "luau", "ping.luau");
  writeFileSync(file, "return 1\n");
  return { file, folder };
}

function recordingRunner(calls: Call[], lintStatus = 0, missing = false): ToolRunner {
  return (tool, _args, cwd) => {
    calls.push({ tool, cwd });
    const failed = tool === "selene" && lintStatus !== 0;
    return { status: lintStatus, output: failed ? "selene says no" : "", missing };
  };
}

await test("formats and lints from the config folder in an ancestor", () => {
  const { file, folder } = makeProject(["stylua.toml", "selene.toml"]);
  const calls: Call[] = [];
  const result = checkLuauFile(file, recordingRunner(calls));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [
    { tool: "stylua", cwd: folder },
    { tool: "selene", cwd: folder },
  ]);
});

await test("accepts .stylua.toml and skips Selene without selene.toml", () => {
  const { file, folder } = makeProject([".stylua.toml"]);
  const calls: Call[] = [];
  checkLuauFile(file, recordingRunner(calls));
  assert.deepEqual(calls, [{ tool: "stylua", cwd: folder }]);
});

await test("runs nothing when no config exists in an ancestor", () => {
  const { file } = makeProject([]);
  const calls: Call[] = [];
  const result = checkLuauFile(file, recordingRunner(calls));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, []);
});

await test("a Selene error exits 2 with its output on stderr", () => {
  const { file } = makeProject(["selene.toml"]);
  const result = checkLuauFile(file, recordingRunner([], 1));
  assert.deepEqual(result, { exitCode: 2, stderr: "selene says no" });
});

await test("a tool missing from PATH is skipped", () => {
  const { file } = makeProject(["stylua.toml", "selene.toml"]);
  const result = checkLuauFile(file, recordingRunner([], 1, true));
  assert.deepEqual(result, { exitCode: 0, stderr: "" });
});

await test("non-Luau and missing files are ignored", () => {
  const { folder } = makeProject(["selene.toml"]);
  const calls: Call[] = [];
  const runner = recordingRunner(calls, 1);
  writeFileSync(path.join(folder, "notes.md"), "");
  assert.equal(checkLuauFile(path.join(folder, "notes.md"), runner).exitCode, 0);
  assert.equal(checkLuauFile(path.join(folder, "luau", "gone.luau"), runner).exitCode, 0);
  assert.deepEqual(calls, []);
});

await test("reads tool_input.file_path from the stdin JSON", () => {
  assert.equal(
    filePathFromInput('{"tool_input":{"file_path":"luau/ping.luau"}}'),
    "luau/ping.luau",
  );
  assert.equal(filePathFromInput("not json"), undefined);
  assert.equal(filePathFromInput('{"tool_input":{}}'), undefined);
  assert.equal(filePathFromInput("null"), undefined);
});
