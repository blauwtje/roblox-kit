import assert from "node:assert/strict";
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

function recordsReply(overrides: object = {}): object {
  return { props: [], surfaces: [], lights: [], heroParts: [], ...overrides };
}

function studioReturning(checked: string, records: object = recordsReply(), isError = false) {
  const batch = `[${checked},${JSON.stringify(records)},${zonesReply}]`;
  return new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const code = String(request.arguments["code"]);
      const reply = code.includes("SceneDrawcallCount") ? samplesReply : batch;
      return { content: [{ type: "text", text: isError ? checked : reply }], isError };
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

const zeroCounts = {
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
};

const doorSpec = {
  mapId: "arena",
  doorWidth: 6,
  rooms: [
    { name: "a", x: 0, z: 0, width: 30, depth: 30, doors: [{ side: "east", offset: 0 }] },
    { name: "b", x: 60, z: 0, width: 30, depth: 30, doors: [{ side: "west", offset: 0 }] },
  ],
};
const litRooms = [
  { path: partPath("a-light"), position: { x: 0, y: 8, z: 0 } },
  { path: partPath("b-light"), position: { x: 60, y: 8, z: 0 } },
];
const surfaceSide = config.maxUntexturedSurfaceStuds + 4;
const flatSurface = (name: string, textured: boolean) => ({
  path: partPath(name),
  size: { x: surfaceSide, y: 1, z: surfaceSide },
  position: { x: 0, y: 0, z: 0 },
  textured,
});
const bench = { kind: "bench", position: { x: 1, y: 2, z: 3 }, upright: true };
const blocked = "Workspace.RobloxKitMaps.other blocks 1 failed walk(s)";

interface Row {
  name: string;
  input: object;
  checked?: object;
  records?: object;
  kinds: string[];
  counts?: Partial<typeof zeroCounts>;
  passed: boolean;
  warnings?: string[];
  omitted?: number;
  overBudget?: boolean;
}

const rows: Row[] = [
  { name: "a clean map passes", input: { mapId: "arena" }, kinds: [], passed: true },
  {
    name: "Studio issues keep their order, cap inline and count the rest as omitted",
    input: { mapId: "arena" },
    checked: {
      counts: { overlapping: 15, floating: 10, unreachable: 1, placement: 2 },
      issues: {
        overlapping: Array.from({ length: 15 }, (_, i) =>
          issueOf("overlapping", `wall-${String(i)}`),
        ),
        floating: Array.from({ length: 10 }, (_, i) => issueOf("floating", `crate-${String(i)}`)),
        unreachable: [issueOf("unreachable", "vault-floor")],
        placement: [issueOf("placement", "bench-1"), issueOf("placement", "bench-2")],
      },
    },
    kinds: [...Array<string>(15).fill("overlapping"), ...Array<string>(5).fill("floating")],
    counts: { overlapping: 15, floating: 10, unreachable: 1, placement: 2 },
    passed: false,
    omitted: 8,
  },
  {
    name: "a warning from Studio is passed on",
    input: { mapId: "arena" },
    checked: {
      counts: { overlapping: 0, floating: 0, unreachable: 1, placement: 0 },
      issues: {
        overlapping: [],
        floating: [],
        unreachable: [issueOf("unreachable", "vault-floor")],
        placement: [],
      },
      warnings: [blocked],
    },
    kinds: ["unreachable"],
    counts: { unreachable: 1 },
    passed: false,
    warnings: [blocked],
  },
  {
    name: "a zone camera over the spec budget warns without failing",
    input: {
      mapId: "arena",
      spec: {
        mapId: "arena",
        rooms: [{ name: "start", x: 0, z: 0, width: 30, depth: 30 }],
        performanceBudget: { maxDrawCalls: 20, maxTriangles: 5000 },
      },
    },
    kinds: [],
    passed: true,
    overBudget: true,
    warnings: [
      'Zone "vault" camera sees 30 draw calls, over the budget of 20.',
      'Zone "vault" camera sees 9000 triangles, over the budget of 5000.',
    ],
  },
  {
    name: "a preset with a spec adds sizeRule issues",
    input: { mapId: "arena", preset: "horror-facility", spec: doorSpec },
    records: recordsReply({ lights: litRooms }),
    kinds: ["sizeRule", "sizeRule"],
    counts: { sizeRule: 2 },
    passed: false,
  },
  {
    name: "a spec alone or a preset alone adds no sizeRule issue",
    input: { mapId: "arena", spec: doorSpec },
    kinds: [],
    passed: true,
  },
  {
    name: "quality rules report untextured, unlit and unbevelled after sizeRule",
    input: { mapId: "arena", preset: "horror-facility", spec: doorSpec },
    records: recordsReply({
      surfaces: [
        flatSurface("a-floor", false),
        flatSurface("a-ceiling", true),
        { ...flatSurface("a-trim", false), size: { x: surfaceSide, y: 1, z: 2 } },
      ],
      lights: [{ path: partPath("a-light"), position: { x: 1, y: 8, z: 1 } }],
      heroParts: [
        { path: partPath("t.wall"), kind: "train-car", position: bench.position, bevel: 0 },
        { path: partPath("t.trim"), kind: "train-car", position: bench.position, bevel: 0.1 },
      ],
    }),
    kinds: ["sizeRule", "sizeRule", "untextured", "unlit", "unbevelled"],
    counts: { sizeRule: 2, untextured: 1, unlit: 1, unbevelled: 1 },
    passed: false,
  },
  {
    name: "without the spec the rooms are unknown so unlit is skipped",
    input: { mapId: "arena", preset: "horror-facility" },
    records: recordsReply({ surfaces: [flatSurface("a-floor", false)] }),
    kinds: ["untextured"],
    counts: { untextured: 1 },
    passed: false,
  },
  {
    name: "a flatSurfaces preset reports no untextured issue",
    input: { mapId: "arena", preset: "train-station" },
    records: recordsReply({ surfaces: [flatSurface("a-floor", false)] }),
    kinds: [],
    passed: true,
  },
  {
    name: "props out of scale or off the grid become scale and rotation issues",
    input: { mapId: "arena", preset: "train-station" },
    records: recordsReply({
      props: [
        { ...bench, path: partPath("bench-1"), size: { x: 6, y: 3, z: 2 }, yaw: 90 },
        { ...bench, path: partPath("bench-2"), size: { x: 6, y: 9, z: 2 }, yaw: 30 },
      ],
    }),
    kinds: ["scale", "rotation"],
    counts: { scale: 1, rotation: 1 },
    passed: false,
  },
  {
    name: "records are ignored without a preset",
    input: { mapId: "arena" },
    records: recordsReply({ surfaces: [flatSurface("a-floor", false)] }),
    kinds: [],
    passed: true,
  },
];

for (const row of rows) {
  await test(`check_map: ${row.name}`, async () => {
    const checked = JSON.parse(checkedMap(row.checked)) as { counts: object };
    const studio = studioReturning(JSON.stringify(checked), row.records);
    const { reports, tool, run } = setup(studio);
    const result = await run(row.input);
    const out = tool.outputSchema.parse(result.structuredContent);

    assert.equal(studio.requests.length, 2);
    assert.deepEqual(out.counts, { ...zeroCounts, ...checked.counts, ...row.counts });
    assert.deepEqual(
      out.issues.map((issue) => issue.kind),
      row.kinds,
    );
    assert.equal(out.passed, row.passed);
    assert.equal(out.issuesOmitted, row.omitted ?? 0);
    assert.deepEqual(out.warnings, row.warnings ?? []);
    assert.equal(out.withinBudget, row.overBudget !== true);
    assert.deepEqual(out.sceneStats, [
      { zone: "start", drawCalls: 12, triangles: 3400 },
      { zone: "vault", drawCalls: 30, triangles: 9000 },
    ]);
    assert.equal(reports.get(out.reportId)?.issues.length, out.issues.length + out.issuesOmitted);
    assert.equal(out.partCount, 9);
  });
}

await test("check_map reads checks, props and zones in one call, then samples the scene", async () => {
  const studio = studioReturning(checkedMap());
  await setup(studio).run({ mapId: "arena", objectives: [{ name: "flag", x: 1, y: 2, z: 3 }] });
  const [batch, sampling] = studio.requests.map((request) => String(request.arguments["code"]));
  assert.ok(batch?.includes('"objectives":[{"name":"flag","x":1,"y":2,"z":3}]'));
  assert.ok(batch?.includes("UPRIGHT_MINIMUM_UP_Y") && batch.includes('"spawnNameSuffix"'));
  assert.ok(sampling?.includes('"zone":"vault"'));
});

await test("a missing map or a malformed result fails, passing on Studio's actionable text", async () => {
  const message =
    'No map "arena" under Workspace.RobloxKitMaps. Call build_map with this mapId first.';
  await assert.rejects(
    setup(studioReturning(message, recordsReply(), true)).run({ mapId: "arena" }),
    /Call build_map/,
  );
  await assert.rejects(setup(studioReturning('{"partCount":"many"}')).run({ mapId: "arena" }));
});

await test("a bad request is refused before Studio is asked", async () => {
  const studio = new FakeStudioConnection([...studios, { id: "studio-b", name: "Place B" }]);
  const { run, tool } = setup(studio);
  await assert.rejects(run({ mapId: "arena" }), /Pass studioId as one of/);
  await assert.rejects(run({ mapId: "arena", preset: "no-such-preset" }), /Unknown preset/);
  assert.throws(() => tool.inputSchema.parse({ mapId: "arena", extra: 1 }));
  assert.throws(() => tool.inputSchema.parse({ mapId: "arena", objectives: [{ name: "a" }] }));
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
