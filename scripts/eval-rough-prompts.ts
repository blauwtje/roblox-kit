import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import {
  checkRoughPrompt,
  roughPromptFixtureSchema,
  roughPromptReplySchema,
  type RoughPromptFixture,
} from "../src/eval/rough-prompt-check.ts";
import { runScript } from "./lib/run-script.ts";

const run = promisify(execFile);
const pluginDir = fileURLToPath(new URL("..", import.meta.url));
const fixturesUrl = new URL("../eval/rough-prompts.json", import.meta.url);
const timeoutMs = 300_000;

function brief(prompt: string): string {
  return `${prompt}\n\nDo not call any tool and do not touch Studio. Answer with the exact build_map input you would send for this request in buildMapInput, and the questions you would ask the user first in questions (ask at most one, none when you can proceed).`;
}

async function ask(prompt: string) {
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(roughPromptReplySchema) };
  delete jsonSchema["$schema"];
  const pending = run(
    "claude",
    [
      "-p",
      "--plugin-dir",
      pluginDir,
      "--tools",
      "",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(jsonSchema),
    ],
    { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
  );
  pending.child.stdin?.end(brief(prompt));
  const { stdout } = await pending;
  const reply = z
    .object({ is_error: z.boolean(), result: z.string(), structured_output: z.unknown() })
    .parse(JSON.parse(stdout));
  if (reply.is_error) throw new Error(reply.result);
  return roughPromptReplySchema.parse(reply.structured_output);
}

async function judge(fixture: RoughPromptFixture): Promise<string> {
  try {
    const result = checkRoughPrompt(fixture, await ask(fixture.prompt));
    return result.pass ? "pass" : `FAIL: ${result.problems.join("; ")}`;
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

await runScript({
  name: "eval-rough-prompts",
  usage:
    "Usage: node scripts/eval-rough-prompts.ts\nRuns headless `claude -p` with this plugin on each prompt in eval/rough-prompts.json and prints a pass table. It costs money, so run it by hand.",
  run: async () => {
    const fixtures = z
      .array(roughPromptFixtureSchema)
      .parse(JSON.parse(await readFile(fixturesUrl, "utf8")));
    let failed = 0;
    for (const fixture of fixtures) {
      const verdict = await judge(fixture);
      if (verdict !== "pass") failed++;
      console.log(`${verdict.padEnd(6)} | ${fixture.prompt}`);
    }
    return failed === 0 ? 0 : 1;
  },
});
