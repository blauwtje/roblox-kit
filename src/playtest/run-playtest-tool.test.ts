import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { FakeStudioConnection, type FakeToolHandler } from "../studio/fake-studio-connection.ts";
import { createRunPlaytestTool } from "./run-playtest-tool.ts";

const studios = [{ id: "studio-a", name: "Place A" }];

function luauText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function codeOf(request: Parameters<FakeToolHandler>[0] | undefined): string {
  assert.ok(request !== undefined, "the request was not sent");
  const code = request.arguments["code"];
  assert.ok(typeof code === "string");
  return code;
}

/** Answers cleanup calls with an empty session and run calls with `onRun`. */
function connectionWith(
  onRun: FakeToolHandler,
  stopPlay: FakeToolHandler = () => luauText("stopped"),
): FakeStudioConnection {
  return new FakeStudioConnection(studios, {
    execute_luau: (request) =>
      codeOf(request).includes('"action":"cleanup"') ? luauText('{"ended":false}') : onRun(request),
    start_stop_play: stopPlay,
  });
}

function callTool(
  connection: FakeStudioConnection,
  input: Record<string, unknown>,
  deadlineMarginMs?: number,
) {
  const tool = createRunPlaytestTool(deadlineMarginMs);
  return tool.handler(tool.inputSchema.parse(input), { studio: connection });
}

function structured(result: CallToolResult): Record<string, unknown> {
  const { structuredContent } = result;
  assert.ok(structuredContent !== undefined && structuredContent !== null);
  return { ...structuredContent };
}

const twoPeerReport = {
  ended: true,
  report: {
    peers: [
      { peer: "server", checks: [{ name: "spawn exists", passed: true, detail: "" }] },
      { peer: "Player1", checks: [{ name: "hud visible", passed: false, detail: "no HUD" }] },
    ],
    errors: [],
  },
};

await test("returns the per-peer report with counts and inserts both harnesses", async () => {
  const connection = connectionWith(() => luauText(JSON.stringify(twoPeerReport)));
  const result = await callTool(connection, {
    mode: "play",
    serverChecks: 'check("spawn exists", true)',
    clientChecks: 'check("hud visible", false, "no HUD")',
  });
  const report = structured(result);
  assert.equal(report["passed"], false);
  assert.deepEqual(report["checks"], { total: 2, passed: 1, failed: 1 });
  assert.deepEqual(report["errors"], []);
  assert.deepEqual(report["peers"], twoPeerReport.report.peers);
  assert.equal(typeof report["durationMs"], "number");
  assert.equal(result.content[0]?.type, "text");
  const runCode = codeOf(connection.requests[0]);
  assert.ok(runCode.includes('"mode":"play"'));
  assert.ok(runCode.includes('"expectedClients":1'));
  assert.ok(runCode.includes('check(\\"spawn exists\\", true)'));
  assert.ok(runCode.includes('check(\\"hud visible\\", false, \\"no HUD\\")'));
  assert.ok(codeOf(connection.requests[1]).includes('"action":"cleanup"'));
});

await test("passes when every check passes and no error was reported", async () => {
  const connection = connectionWith(() =>
    luauText(
      JSON.stringify({
        ended: true,
        report: {
          peers: [{ peer: "server", checks: [{ name: "a", passed: true, detail: "" }] }],
          errors: [],
        },
      }),
    ),
  );
  const report = structured(
    await callTool(connection, { mode: "run", serverChecks: 'check("a", true)' }),
  );
  assert.equal(report["passed"], true);
  assert.ok(codeOf(connection.requests[0]).includes('"expectedClients":0'));
});

await test("multiplayer expects one client per player and keeps harness errors", async () => {
  const connection = connectionWith(() =>
    luauText(
      JSON.stringify({
        ended: true,
        report: {
          peers: [{ peer: "server", checks: [{ name: "a", passed: true, detail: "" }] }],
          errors: ["1 of 3 clients reported within 5 s (3 joined)"],
        },
      }),
    ),
  );
  const report = structured(
    await callTool(connection, {
      mode: "multiplayer",
      players: 3,
      serverChecks: 'check("a", true)',
      timeoutSeconds: 5,
    }),
  );
  assert.equal(report["passed"], false);
  assert.deepEqual(report["errors"], ["1 of 3 clients reported within 5 s (3 joined)"]);
  const runCode = codeOf(connection.requests[0]);
  assert.ok(runCode.includes('"expectedClients":3'));
  assert.ok(runCode.includes('"timeoutSeconds":5'));
});

await test("a report without any check fails with an error", async () => {
  const connection = connectionWith(() =>
    luauText(
      JSON.stringify({
        ended: true,
        report: { peers: [{ peer: "server", checks: [] }], errors: [] },
      }),
    ),
  );
  const report = structured(await callTool(connection, { mode: "run", serverChecks: "" }));
  assert.equal(report["passed"], false);
  assert.match(String((report["errors"] as string[])[0]), /No check was recorded/);
});

await test("a session that never ends is stopped, cleaned up and reported with the syntax-error hint", async () => {
  const connection = connectionWith(() => new Promise<CallToolResult>(() => undefined));
  await assert.rejects(
    callTool(
      connection,
      { mode: "run", serverChecks: "this is not luau (", timeoutSeconds: 1 },
      30,
    ),
    /did not end within 1 s[\s\S]*syntax error[\s\S]*get_console_output/,
  );
  const names = connection.requests.map((request) => request.name);
  assert.deepEqual(names, ["execute_luau", "start_stop_play", "execute_luau"]);
  assert.deepEqual(connection.requests[1]?.arguments, { is_start: false });
  assert.ok(codeOf(connection.requests[2]).includes('"action":"cleanup"'));
});

await test("removes the harness and reports the Studio error when the run fails", async () => {
  const connection = connectionWith(() => ({
    content: [{ type: "text", text: "A test session is already running" }],
    isError: true,
  }));
  await assert.rejects(
    callTool(connection, { mode: "run", serverChecks: 'check("a", true)' }),
    /run-playtest\.luau failed in Studio: A test session is already running/,
  );
  assert.equal(connection.requests.length, 2);
  assert.ok(codeOf(connection.requests[1]).includes('"action":"cleanup"'));
});

await test("names the leftover scripts when cleanup fails after a good run", async () => {
  const connection = new FakeStudioConnection(studios, {
    execute_luau: (request) =>
      codeOf(request).includes('"action":"cleanup"')
        ? { content: [{ type: "text", text: "no StarterPlayerScripts" }], isError: true }
        : luauText(JSON.stringify(twoPeerReport)),
  });
  await assert.rejects(
    callTool(connection, { serverChecks: 'check("a", true)' }),
    /RobloxKitPlaytestServerHarness[\s\S]*no StarterPlayerScripts/,
  );
});

await test("reports a session that ended without the harness report", async () => {
  const connection = connectionWith(() => luauText('{"ended":false}'));
  await assert.rejects(
    callTool(connection, { serverChecks: 'check("a", true)' }),
    /ended without a report/,
  );
});

await test("rejects inputs that cannot run before touching Studio", async () => {
  const connection = connectionWith(() => luauText("{}"));
  await assert.rejects(callTool(connection, {}), /Give serverChecks or clientChecks/);
  await assert.rejects(
    callTool(connection, { mode: "run", clientChecks: "x" }),
    /starts no client/,
  );
  await assert.rejects(
    callTool(connection, { mode: "play", players: 2, serverChecks: "x" }),
    /only applies to mode "multiplayer"/,
  );
  assert.equal(connection.requests.length, 0);
});

await test("the input schema bounds players and timeout", () => {
  const tool = createRunPlaytestTool();
  assert.ok(!tool.inputSchema.safeParse({ players: 9 }).success);
  assert.ok(!tool.inputSchema.safeParse({ players: 0 }).success);
  assert.ok(!tool.inputSchema.safeParse({ timeoutSeconds: 0 }).success);
  assert.ok(!tool.inputSchema.safeParse({ timeoutSeconds: 51 }).success);
  assert.ok(!tool.inputSchema.safeParse({ unknown: 1 }).success);
});
