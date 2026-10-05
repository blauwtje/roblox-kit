import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "../config.ts";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { createJudgeRoundTool } from "./judge-round-tool.ts";

const spec = {
  mapId: "station",
  rooms: [{ name: "hall", roomType: "ticket-hall", x: 0, z: 0, width: 20, depth: 20 }],
  style: { preset: "train-station" },
};

const finding = {
  type: "palette",
  severity: "major",
  cites: "train-station palette",
  evidence: { imageId: "hall:a", visible: "grey walls" },
  reasoning: "r",
  verdict: "v",
};

function call(projectDir: string | undefined, input: Record<string, unknown>) {
  const tool = createJudgeRoundTool(projectDir);
  return tool.handler(
    tool.inputSchema.parse({
      round: 1,
      spec,
      zones: ["hall"],
      findings: [],
      placeChecks: [],
      qualityAnswers: [],
      ...input,
    }),
    {
      studio: new FakeStudioConnection([], {}),
    },
  );
}

function field(result: Awaited<ReturnType<typeof call>>, name: string): unknown {
  return (result.structuredContent as Record<string, unknown>)[name];
}

async function inProject(run: (folder: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "judge-round-"));
  try {
    await run(folder);
  } finally {
    await rm(folder, { recursive: true });
  }
}

async function logLines(folder: string): Promise<{ round: number; findings: unknown[] }[]> {
  const text = await readFile(join(folder, config.judgeLogFile), "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { round: number; findings: unknown[] });
}

await test("a round appends one line to the log and creates .gitignore under the project folder", async () => {
  await inProject(async (folder) => {
    const result = await call(folder, { findings: [finding] });
    assert.equal(field(result, "stopReason"), null);
    const lines = await logLines(folder);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.findings.length, 1);
    assert.equal(await readFile(join(folder, ".gitignore"), "utf8"), ".roblox-kit/\n");
  });
});

await test("a second round reads the first line to mark a repeat and appends another line", async () => {
  await inProject(async (folder) => {
    await call(folder, { findings: [finding] });
    const result = await call(folder, { round: 2, findings: [finding] });
    assert.equal(field(result, "stopReason"), "repeat");
    assert.equal((await logLines(folder)).length, 2);
  });
});

await test(".gitignore keeps its lines and gains .roblox-kit/ once", async () => {
  await inProject(async (folder) => {
    await writeFile(join(folder, ".gitignore"), "node_modules/");
    await call(folder, {});
    await call(folder, {});
    assert.equal(
      await readFile(join(folder, ".gitignore"), "utf8"),
      "node_modules/\n.roblox-kit/\n",
    );
  });
});

await test("an existing .roblox-kit entry is left alone", async () => {
  await inProject(async (folder) => {
    await writeFile(join(folder, ".gitignore"), ".roblox-kit\n");
    await call(folder, {});
    assert.equal(await readFile(join(folder, ".gitignore"), "utf8"), ".roblox-kit\n");
  });
});

await test("a finding without evidence.visible comes back rejected and stays out of the log", async () => {
  await inProject(async (folder) => {
    const bare = { ...finding, evidence: { imageId: "hall:a" } };
    const result = await call(folder, { findings: [bare] });
    assert.deepEqual(field(result, "rejected"), [bare]);
    assert.deepEqual((await logLines(folder))[0]?.findings, []);
  });
});

await test("a missing, empty, relative or unexpanded project folder fails before any write", async () => {
  await inProject(async (folder) => {
    for (const bad of [
      undefined,
      "",
      "  ",
      "relative/dir",
      "${CLAUDE_PROJECT_DIR}",
      join(folder, "${X}"),
    ]) {
      await assert.rejects(call(bad, {}), /PROJECT_DIR/);
    }
    assert.equal(existsSync(join(folder, ".roblox-kit")), false);
    assert.equal(existsSync(join(folder, ".gitignore")), false);
  });
});
