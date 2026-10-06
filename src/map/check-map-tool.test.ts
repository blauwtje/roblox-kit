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
    counts: { overlapping: 0, floating: 0, unreachable: 0, placement: 0 },
    issues: { overlapping: [], floating: [], unreachable: [], placement: [] },
    warnings: [],
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
function recordsReply(overrides: object = {}): string {
  return JSON.stringify({ props: [], surfaces: [], lights: [], heroParts: [], ...overrides });
}

function studioReturning(text: string, isError = false, propsReply = recordsReply()) {
  return new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const code = String(request.arguments["code"]);
      const reply = code.includes("SceneDrawcallCount")
        ? samplesReply
        : code.includes('"spawnNameSuffix"')
          ? zonesReply
          : code.includes("UPRIGHT_MINIMUM_UP_Y")
            ? propsReply
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
      counts: { overlapping: 15, floating: 10, unreachable: 1, placement: 0 },
      issues: { overlapping, floating, unreachable, placement: [] },
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
    placement: 0,
    sizeRule: 0,
    scale: 0,
    rotation: 0,
    untextured: 0,
    unlit: 0,
    unbevelled: 0,
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
      counts: { overlapping: 0, floating: 1, unreachable: 0, placement: 0 },
      issues: {
        overlapping: [],
        floating: [issueOf("floating", "crate")],
        unreachable: [],
        placement: [],
      },
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
  assert.ok(floatingSource.includes("Vector3.new(center.X, originY, center.Z)"));
  assert.ok(floatingSource.includes("workspace:Raycast(origin, reach, params)"));
  assert.ok(floatingSource.includes("Vector3.new(0, -2 * tolerance, 0)"));
  // The part's own body is excluded from its rays, and non-colliding parts are neither cast from nor hit.
  assert.ok(floatingSource.includes("params.FilterDescendantsInstances = { part }"));
  assert.ok(floatingSource.includes("params.FilterType = Enum.RaycastFilterType.Exclude"));
  assert.ok(floatingSource.includes("params.RespectCanCollide = true"));
  assert.ok(floatingSource.includes("if not part.CanCollide then"));
  // A map part only supports what rests on it once it is grounded itself, so a stack on a floating part floats.
  assert.ok(floatingSource.includes("support:IsDescendantOf(model)"));
  assert.ok(floatingSource.includes("for _, resting in restingOn[support]"));
  assert.ok(floatingSource.includes("if not grounded[part] then"));
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

await test("scene stats within the config budget add no warning when the spec sets no budget", async () => {
  const structured = (await setup(studioReturning(checkedMap())).run({ mapId: "arena" }))
    .structuredContent as { budget: object; withinBudget: boolean; warnings: string[] };
  assert.deepEqual(structured.budget, {
    maxDrawCalls: config.maxDrawCalls,
    maxTriangles: config.maxTriangles,
  });
  assert.equal(structured.withinBudget, true);
  assert.deepEqual(structured.warnings, []);
});

await test("a zone camera over the spec's performanceBudget is warned about without failing the check", async () => {
  const spec = {
    mapId: "arena",
    rooms: [{ name: "start", x: 0, z: 0, width: 30, depth: 30 }],
    performanceBudget: { maxDrawCalls: 20, maxTriangles: 5000 },
  };
  const { tool, run } = setup(studioReturning(checkedMap()));
  const structured = tool.outputSchema.parse(
    (await run({ mapId: "arena", spec })).structuredContent,
  );
  assert.deepEqual(structured.budget, { maxDrawCalls: 20, maxTriangles: 5000 });
  assert.equal(structured.withinBudget, false);
  assert.equal(structured.passed, true);
  assert.deepEqual(structured.warnings, [
    'Zone "vault" camera sees 30 draw calls, over the budget of 20.',
    'Zone "vault" camera sees 9000 triangles, over the budget of 5000.',
  ]);
});

await test("a warning from Studio naming a model outside the map is passed on", async () => {
  const blocked = "Workspace.RobloxKitMaps.other blocks 1 failed walk(s)";
  const { tool, run } = setup(
    studioReturning(
      checkedMap({
        counts: { overlapping: 0, floating: 0, unreachable: 1, placement: 0 },
        issues: {
          overlapping: [],
          floating: [],
          unreachable: [issueOf("unreachable", "vault-floor")],
          placement: [],
        },
        warnings: [blocked],
      }),
    ),
  );
  const structured = tool.outputSchema.parse((await run({ mapId: "arena" })).structuredContent);
  assert.deepEqual(structured.warnings, [blocked]);
  assert.equal(structured.withinBudget, true);
});

await test("check-map.luau names the instances outside the map on the line of a failed walk", async () => {
  const source = await readFile(new URL("../../luau/check-map.luau", import.meta.url), "utf8");
  const blockerSource = source.slice(
    source.indexOf("local function ownerOf("),
    source.indexOf("local function findUnreachableTargets("),
  );
  // The map itself and Terrain are excluded, and each hit's owner is excluded before the next cast.
  assert.ok(blockerSource.includes("{ model, workspace.Terrain }"));
  assert.ok(blockerSource.includes("table.insert(excluded, owner)"));
  assert.ok(blockerSource.includes("owner.Parent ~= mapsFolder"));
  assert.ok(blockerSource.includes("blocker:GetFullName()"));
  const reachSource = source.slice(source.indexOf("local function findUnreachableTargets("));
  assert.ok(reachSource.includes("noteBlockers(model, start, target.point"));
  assert.ok(source.includes("warnings = blockerWarnings()"));
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
    doorWidth: 6,
    rooms: [
      { name: "a", x: 0, z: 0, width: 30, depth: 30, doors: [{ side: "east", offset: 0 }] },
      { name: "b", x: 60, z: 0, width: 30, depth: 30, doors: [{ side: "west", offset: 0 }] },
    ],
  };
  const lit = recordsReply({
    lights: [
      { path: partPath("a-light"), position: { x: 0, y: 8, z: 0 } },
      { path: partPath("b-light"), position: { x: 60, y: 8, z: 0 } },
    ],
  });
  const { reports, run } = setup(studioReturning(checkedMap(), false, lit));
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
    assert.deepEqual(plain.counts, {
      overlapping: 0,
      floating: 0,
      unreachable: 0,
      placement: 0,
      sizeRule: 0,
      scale: 0,
      rotation: 0,
      untextured: 0,
      unlit: 0,
      unbevelled: 0,
    });
  }
});

await test("with a preset, quality rules report an untextured flat surface, an unlit room and an unbevelled hero part", async () => {
  const spec = {
    mapId: "arena",
    doorWidth: 6,
    rooms: [
      { name: "a", x: 0, z: 0, width: 30, depth: 30, doors: [{ side: "east", offset: 0 }] },
      { name: "b", x: 60, z: 0, width: 30, depth: 30, doors: [{ side: "west", offset: 0 }] },
    ],
  };
  const side = config.maxUntexturedSurfaceStuds + 4;
  const flat = (name: string, textured: boolean, y: number) => ({
    path: partPath(name),
    size: { x: side, y: 1, z: side },
    position: { x: 0, y, z: 0 },
    textured,
  });
  const reply = recordsReply({
    surfaces: [
      flat("a-floor", false, 0),
      flat("a-ceiling", true, 12),
      { ...flat("a-trim", false, 1), size: { x: side, y: 1, z: 2 } },
    ],
    lights: [{ path: partPath("a-light"), position: { x: 1, y: 8, z: 1 } }],
    heroParts: [
      {
        path: partPath("train-car-hero-1.wall"),
        kind: "train-car",
        position: { x: 1, y: 2, z: 3 },
        bevel: 0,
      },
      {
        path: partPath("train-car-hero-1.trim"),
        kind: "train-car",
        position: { x: 1, y: 2, z: 3 },
        bevel: 0.1,
      },
    ],
  });
  const { reports, tool, run } = setup(studioReturning(checkedMap(), false, reply));
  const result = await run({ mapId: "arena", preset: "horror-facility", spec });
  const structured = tool.outputSchema.parse(result.structuredContent);
  assert.equal(structured.passed, false);
  assert.deepEqual(
    structured.issues
      .filter((issue) => issue.kind !== "sizeRule")
      .map((issue) => [issue.kind, issue.parts]),
    [
      ["untextured", [partPath("a-floor")]],
      ["unlit", []],
      ["unbevelled", [partPath("train-car-hero-1.wall")]],
    ],
  );
  assert.match(structured.issues.find((issue) => issue.kind === "unlit")?.detail ?? "", /Room "b"/);
  assert.equal(structured.counts.untextured, 1);
  assert.equal(structured.counts.unlit, 1);
  assert.equal(structured.counts.unbevelled, 1);
  assert.equal(reports.get(structured.reportId)?.issues.length, 5);

  // Without the spec the rooms are unknown, so only the surface and bevel rules apply.
  const withoutSpec = tool.outputSchema.parse(
    (await run({ mapId: "arena", preset: "horror-facility" })).structuredContent,
  );
  assert.deepEqual(
    withoutSpec.issues.map((issue) => issue.kind),
    ["untextured", "unbevelled"],
  );
});

await test("a preset with flatSurfaces reports no untextured issue for a flat untextured surface", async () => {
  const side = config.maxUntexturedSurfaceStuds + 4;
  const reply = recordsReply({
    surfaces: [
      {
        path: partPath("a-floor"),
        size: { x: side, y: 1, z: side },
        position: { x: 0, y: 0, z: 0 },
        textured: false,
      },
    ],
  });
  const { tool, run } = setup(studioReturning(checkedMap(), false, reply));
  const structured = tool.outputSchema.parse(
    (await run({ mapId: "arena", preset: "train-station" })).structuredContent,
  );
  assert.equal(structured.counts.untextured, 0);
});

await test("with a preset, props out of scale or off the grid become scale and rotation issues naming their part path", async () => {
  const bench = { kind: "bench", position: { x: 1, y: 2, z: 3 }, upright: true };
  const props = [
    { ...bench, path: partPath("bench-1"), size: { x: 6, y: 3, z: 2 }, yaw: 90 },
    { ...bench, path: partPath("bench-2"), size: { x: 6, y: 9, z: 2 }, yaw: 30 },
  ];
  const studio = studioReturning(checkedMap(), false, recordsReply({ props }));
  const { reports, run } = setup(studio);
  const result = await run({ mapId: "arena", preset: "train-station" });
  const structured = result.structuredContent as {
    passed: boolean;
    counts: { scale: number; rotation: number };
    issues: CheckIssue[];
    reportId: string;
  };
  assert.equal(structured.passed, false);
  assert.deepEqual(
    structured.issues.map((issue) => [issue.kind, issue.parts]),
    [
      ["scale", [partPath("bench-2")]],
      ["rotation", [partPath("bench-2")]],
    ],
  );
  assert.equal(structured.counts.scale, 1);
  assert.equal(structured.counts.rotation, 1);
  assert.equal(reports.get(structured.reportId)?.issues.length, 2);
});

await test("placement issues from Studio are counted, fail the check and keep their part paths", async () => {
  const placement = [
    issueOf("placement", "bench-1"),
    {
      ...issueOf("placement", "bench-2"),
      parts: [partPath("bench-2"), partPath("hall-wall-east-1")],
    },
  ];
  const studio = studioReturning(
    checkedMap({
      counts: { overlapping: 0, floating: 0, unreachable: 0, placement: 2 },
      issues: { overlapping: [], floating: [], unreachable: [], placement },
    }),
  );
  const { reports, run } = setup(studio);
  const result = await run({ mapId: "arena" });
  const structured = result.structuredContent as {
    passed: boolean;
    counts: { placement: number };
    issues: CheckIssue[];
    reportId: string;
  };
  assert.equal(structured.passed, false);
  assert.equal(structured.counts.placement, 2);
  assert.deepEqual(
    structured.issues.map((issue) => issue.parts),
    [[partPath("bench-1")], [partPath("bench-2"), partPath("hall-wall-east-1")]],
  );
  assert.equal(reports.get(structured.reportId)?.issues.length, 2);
});

await test("check-map.luau sends doorway clearance boxes from the spec and reports placement by three rules", async () => {
  const spec = {
    mapId: "arena",
    rooms: [{ name: "a", x: 0, z: 0, width: 30, depth: 30, doors: [{ side: "east", offset: 0 }] }],
  };
  const studio = studioReturning(checkedMap());
  await setup(studio).run({ mapId: "arena", preset: "train-station", spec });
  const code = String(studio.requests[0]?.arguments["code"]);
  assert.match(code, /"doorways":\[\{"room":"a","side":"east","min":\{/);
  assert.match(code, /"wallNameInfix":"-wall-"/);
  // A trim profile Model runs along a wall and through door frames, so it is no prop to place.
  assert.match(code, /"trimKindPrefix":"trim-"/);
  const source = await readFile(new URL("../../luau/check-map.luau", import.meta.url), "utf8");
  assert.ok(source.includes("no floor under its center or footprint corners"));
  assert.ok(source.includes("overlaps the wall part"));
  assert.ok(source.includes("inside the doorway clearance box"));
});

await test("check-map.luau flags a free-hanging prop with no floor but passes one whose bounds touch a wall", async () => {
  const source = await readFile(new URL("../../luau/check-map.luau", import.meta.url), "utf8");
  const wallSource = source.slice(
    source.indexOf("local function touchOrOverlap("),
    source.indexOf("local function findPlacement("),
  );
  // Touching counts on every axis within the tolerance: a sign against a wall face is supported, bounds apart are not.
  assert.ok(
    wallSource.includes(
      "extent.X >= -tolerance and extent.Y >= -tolerance and extent.Z >= -tolerance",
    ),
  );
  assert.ok(wallSource.includes("if touchOrOverlap(bounds, wall) then\n\t\t\treturn true"));
  assert.ok(wallSource.includes("return false"));
  // The floor rule fires only when the prop neither rests on a floor nor touches a wall.
  assert.ok(
    source.includes(
      "if not restsOnFloor(bounds, floorParams) and not restsOnWall(bounds, walls) then",
    ),
  );
});
