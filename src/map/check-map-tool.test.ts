import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { config } from "../config.ts";
import { createServer } from "../server/main.ts";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { createCheckMapTool } from "./check-map-tool.ts";
import { CheckReportStore, type CheckIssue, type CheckReport } from "./check-report-store.ts";

const studios = [{ id: "studio-a", name: "Place A" }];
const partPath = (name: string) => `Workspace.${config.mapsFolderName}.arena.${name}`;

function issueOf(kind: CheckIssue["kind"], name: string): CheckIssue {
  return {
    kind,
    parts: [partPath(name)],
    position: { x: 1, y: 2, z: 3 },
    detail: `${kind} ${name}`,
  };
}

function checkedMap(overrides: object = {}): string {
  return JSON.stringify({
    partCount: 9,
    zoneCount: 2,
    reachabilityChecked: true,
    counts: { overlapping: 0, floating: 0, unreachable: 0 },
    issues: { overlapping: [], floating: [], unreachable: [] },
    ...overrides,
  });
}

const zonesReply = JSON.stringify({
  zones: [
    { name: "start", min: { x: 0, y: 0, z: 0 }, max: { x: 40, y: 12, z: 40 } },
    { name: "vault", min: { x: 40, y: 0, z: 0 }, max: { x: 80, y: 12, z: 40 } },
  ],
});

const samplesReply = JSON.stringify({
  samples: [
    { zone: "start", drawCalls: 12, triangles: 3400 },
    { zone: "vault", drawCalls: 30, triangles: 9000 },
  ],
});

/** Answers the check with `text`, and the zone read and the stats sampling that follow it with fixed replies. */
function studioReturning(text: string, isError = false) {
  return new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const code = String(request.arguments["code"]);
      const reply = code.includes("SceneDrawcallCount")
        ? samplesReply
        : code.includes('"spawnNameSuffix"')
          ? zonesReply
          : text;
      return { content: [{ type: "text", text: reply }], isError };
    },
  });
}

function setup(studio: FakeStudioConnection) {
  const reports = new CheckReportStore();
  const tool = createCheckMapTool(reports);
  return {
    reports,
    tool,
    run: (input: object) => tool.handler(tool.inputSchema.parse(input), { studio }),
  };
}

await test("check_map has a strict schema, read-only annotations and the mapId lifetime in its description", () => {
  const { tool } = setup(studioReturning(checkedMap()));
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.match(tool.description, /handle lasts while that Model exists/);
  assert.throws(() => tool.inputSchema.parse({ mapId: "arena", extra: 1 }));
  assert.throws(() => tool.inputSchema.parse({}));
});

await test("a clean map passes and sends the map and tolerances to Studio", async () => {
  const studio = studioReturning(checkedMap());
  const { run } = setup(studio);
  const result = await run({ mapId: "arena" });

  const [request] = studio.requests;
  assert.equal(request?.name, "execute_luau");
  assert.equal(request.arguments["datamodel_type"], "Edit");
  const code = String(request.arguments["code"]);
  assert.ok(code.includes('"mapId":"arena"'));
  assert.ok(code.includes(`"overlapToleranceStuds":${String(config.overlapToleranceStuds)}`));
  assert.ok(code.includes(`"agentRadiusStuds":${String(config.pathfindingAgentRadiusStuds)}`));

  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as { passed: boolean; issues: unknown[] };
  assert.equal(structured.passed, true);
  assert.deepEqual(structured.issues, []);
  const [text, link] = result.content;
  assert.deepEqual(JSON.parse(text?.type === "text" ? text.text : ""), structured);
  assert.equal(link?.type, "resource_link");
});

await test("issues are listed inline up to a cap and all of them are stored under the linked report", async () => {
  const overlapping = Array.from({ length: 15 }, (_, index) =>
    issueOf("overlapping", `wall-${String(index)}`),
  );
  const floating = Array.from({ length: 10 }, (_, index) =>
    issueOf("floating", `crate-${String(index)}`),
  );
  const unreachable = [issueOf("unreachable", "vault-floor")];
  const studio = studioReturning(
    checkedMap({
      counts: { overlapping: 15, floating: 10, unreachable: 1 },
      issues: { overlapping, floating, unreachable },
    }),
  );
  const { reports, tool, run } = setup(studio);
  const result = await run({ mapId: "arena" });

  const structured = tool.outputSchema.parse(result.structuredContent);
  assert.equal(structured.passed, false);
  assert.deepEqual(structured.counts, {
    overlapping: 15,
    floating: 10,
    unreachable: 1,
    sizeRule: 0,
  });
  assert.equal(structured.issues.length, 20);
  assert.equal(structured.issuesOmitted, 6);
  assert.deepEqual(structured.issues[0]?.parts, [partPath("wall-0")]);

  const link = result.content[1];
  assert.ok(link?.type === "resource_link");
  assert.equal(link.uri, structured.reportUri);
  assert.ok(structured.reportUri.startsWith(config.checkReportUriPrefix));
  assert.equal(reports.get(structured.reportId)?.issues.length, 26);
});

await test("a missing map or a malformed result fails, passing on Studio's actionable text", async () => {
  const message =
    'No map "arena" under Workspace.RobloxKitMaps. Call build_map with this mapId first.';
  await assert.rejects(
    setup(studioReturning(message, true)).run({ mapId: "arena" }),
    /Call build_map/,
  );
  await assert.rejects(setup(studioReturning('{"partCount":"many"}')).run({ mapId: "arena" }));
});

await test("asks for a studioId when several Studios are connected", async () => {
  const studio = new FakeStudioConnection([...studios, { id: "studio-b", name: "Place B" }]);
  await assert.rejects(setup(studio).run({ mapId: "arena" }), /Pass studioId as one of/);
  assert.equal(studio.requests.length, 0);
});

await test("the server serves a stored report at its linked uri and refuses an unknown one", async () => {
  const reports = new CheckReportStore();
  const tool = createCheckMapTool(reports);
  const studio = studioReturning(
    checkedMap({
      counts: { overlapping: 0, floating: 1, unreachable: 0 },
      issues: { overlapping: [], floating: [issueOf("floating", "crate")], unreachable: [] },
    }),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const serverInfo = { name: "roblox-kit-test", version: "0.0.0" };
  await createServer({ serverInfo, studio, tools: [tool], checkReports: reports }).connect(
    serverTransport,
  );
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  try {
    const called = await client.callTool({ name: "check_map", arguments: { mapId: "arena" } });
    const uri = (called.structuredContent as { reportUri: string }).reportUri;
    const read = await client.readResource({ uri });
    const [contents] = read.contents;
    const report = JSON.parse(
      contents !== undefined && "text" in contents ? contents.text : "{}",
    ) as CheckReport;
    assert.equal(report.mapId, "arena");
    assert.equal(report.issues[0]?.detail, "floating crate");
    await assert.rejects(
      client.readResource({ uri: `${config.checkReportUriPrefix}missing` }),
      /call check_map again/,
    );
  } finally {
    await client.close();
  }
});

await test("check-map.luau is strict, caps its issue lists and reads the map from the mapId", async () => {
  const source = await readFile(new URL("../../luau/check-map.luau", import.meta.url), "utf8");
  assert.ok(source.startsWith("--!strict"));
  assert.ok(source.includes("MAX_ISSUES_PER_KIND"));
  assert.ok(source.includes("CreatePath"));
  assert.ok(source.includes("Call build_map with this mapId first"));
});

await test("check-map.luau counts an overlap only between two collidable parts, in a broad then a narrow pass", async () => {
  const source = await readFile(new URL("../../luau/check-map.luau", import.meta.url), "utf8");
  const overlapSource = source.slice(
    source.indexOf("local function findOverlaps("),
    source.indexOf("local function rayOrigins("),
  );
  const broadPass = overlapSource.indexOf("GetPartBoundsInBox");
  const narrowPass = overlapSource.indexOf("GetPartsInPart");
  assert.ok(broadPass !== -1 && narrowPass > broadPass);
  assert.ok(overlapSource.includes("params.RespectCanCollide = true"));
  // A non-colliding part is skipped as the queried part; RespectCanCollide drops it from the results.
  assert.ok(overlapSource.includes("if not part.CanCollide then"));
  assert.ok(!source.includes("findContacts"));
});

await test("check-map.luau reports a part as floating when none of five downward rays hits support", async () => {
  const source = await readFile(new URL("../../luau/check-map.luau", import.meta.url), "utf8");
  const floatingSource = source.slice(
    source.indexOf("local function rayOrigins("),
    source.indexOf("local function isWithinFootprint("),
  );
  // One origin at the bottom face center and one per footprint corner.
  const originBlock = floatingSource.slice(
    floatingSource.indexOf("return {"),
    floatingSource.indexOf("\nend"),
  );
  assert.equal(originBlock.match(/Vector3\.new\(/g)?.length, 5);
  assert.ok(floatingSource.includes("box.part.Position.X"));
  assert.ok(floatingSource.includes("workspace:Raycast(origin, reach, params)"));
  assert.ok(floatingSource.includes("Vector3.new(0, -2 * tolerance, 0)"));
  // The part's own body is excluded from its rays, and non-colliding parts are neither cast from nor hit.
  assert.ok(floatingSource.includes("params.FilterDescendantsInstances = { part }"));
  assert.ok(floatingSource.includes("params.FilterType = Enum.RaycastFilterType.Exclude"));
  assert.ok(floatingSource.includes("params.RespectCanCollide = true"));
  assert.ok(floatingSource.includes("if not part.CanCollide or isGround(box) then"));
  assert.ok(floatingSource.includes('kind = "floating"'));
});

await test("check_map samples the scene from each zone's camera after the settle time", async () => {
  const studio = studioReturning(checkedMap());
  const result = await setup(studio).run({ mapId: "arena" });

  const structured = result.structuredContent as { passed: boolean; sceneStats: unknown[] };
  assert.deepEqual(structured.sceneStats, [
    { zone: "start", drawCalls: 12, triangles: 3400 },
    { zone: "vault", drawCalls: 30, triangles: 9000 },
  ]);
  assert.equal(structured.passed, true);
  const [, , sampling] = studio.requests;
  const code = String(sampling?.arguments["code"]);
  assert.ok(code.includes(`"statsSettleSeconds":${String(config.statsSettleSeconds)}`));
  assert.ok(code.includes('"zone":"start"') && code.includes('"zone":"vault"'));
  assert.ok(code.includes('"cameraPosition":['));
});

await test("objectives and a preset's agent size are sent to Studio, defaults otherwise", async () => {
  const objectives = [{ name: "flag", x: 1, y: 2, z: 3 }];
  const plain = studioReturning(checkedMap());
  await setup(plain).run({ mapId: "arena", objectives });
  const plainCode = String(plain.requests[0]?.arguments["code"]);
  assert.ok(plainCode.includes(`"objectives":${JSON.stringify(objectives)}`));
  assert.ok(plainCode.includes('"maxPathStuds":3000'));
  assert.ok(plainCode.includes(`"agentHeightStuds":${String(config.pathfindingAgentHeightStuds)}`));

  const presetName = "horror-facility";
  const styled = studioReturning(checkedMap());
  await setup(styled).run({ mapId: "arena", preset: presetName });
  const styledCode = String(styled.requests[0]?.arguments["code"]);
  assert.ok(styledCode.includes('"objectives":[]'));
  assert.ok(styledCode.includes('"agentRadiusStuds":'));
});

await test("an unknown preset or a malformed objective is refused before Studio is asked", async () => {
  const studio = studioReturning(checkedMap());
  const { run, tool } = setup(studio);
  await assert.rejects(run({ mapId: "arena", preset: "no-such-preset" }), /Unknown preset/);
  assert.throws(() => tool.inputSchema.parse({ mapId: "arena", objectives: [{ name: "a" }] }));
  assert.equal(studio.requests.length, 0);
});

await test("check-map.luau walks every spawn to every room and objective and reports far pairs as tooFar", async () => {
  const source = await readFile(new URL("../../luau/check-map.luau", import.meta.url), "utf8");
  const reachSource = source.slice(source.indexOf("local function collectTargets("));
  assert.ok(reachSource.includes("for _, spawnPart in spawns do"));
  assert.ok(reachSource.includes("for _, target in targets do"));
  assert.ok(reachSource.includes("arguments.objectives"));
  assert.ok(reachSource.includes("pcall(function()"));
  assert.ok(reachSource.includes("path.Status ~= Enum.PathStatus.Success"));
  assert.ok(reachSource.includes("#path:GetWaypoints() == 0"));
  assert.ok(reachSource.includes("distance > arguments.maxPathStuds"));
  assert.ok(reachSource.includes("tooFar"));
  assert.ok(!source.includes("spawns[1]"));
});

await test("a preset with a spec adds sizeRule issues to the counts and the report, without them none", async () => {
  const spec = {
    mapId: "arena",
    rooms: [
      { name: "a", x: 0, z: 0, width: 30, depth: 30, doors: [{ side: "east", offset: 0 }] },
      { name: "b", x: 60, z: 0, width: 30, depth: 30, doors: [{ side: "west", offset: 0 }] },
    ],
  };
  const { reports, run } = setup(studioReturning(checkedMap()));
  const styled = (await run({ mapId: "arena", preset: "horror-facility", spec }))
    .structuredContent as { passed: boolean; counts: { sizeRule: number }; issues: CheckIssue[] };
  assert.equal(styled.passed, false);
  assert.equal(styled.counts.sizeRule, 2);
  assert.ok(styled.issues.every((issue) => issue.kind === "sizeRule"));
  assert.equal(reports.get(String((styled as { reportId?: string }).reportId))?.issues.length, 2);

  for (const input of [
    { mapId: "arena", spec },
    { mapId: "arena", preset: "horror-facility" },
  ]) {
    const plain = (await run(input)).structuredContent as { passed: boolean; counts: object };
    assert.equal(plain.passed, true);
    assert.deepEqual(plain.counts, { overlapping: 0, floating: 0, unreachable: 0, sizeRule: 0 });
  }
});
