import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { recordedHeroAsset } from "../hero-props/hero-prop-asset.ts";
import { loadPresets } from "../style/load-preset.ts";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { buildMapTool } from "./build-map-tool.ts";

const studios = [{ id: "studio-a", name: "Place A" }];

const twoRoomSpec = {
  mapId: "two-rooms",
  rooms: [
    { name: "start", x: 0, z: 0, width: 40, depth: 40, spawn: true, doors: [{ side: "east" }] },
    { name: "hall", x: 40, z: 0, width: 40, depth: 40, doors: [{ side: "west" }] },
  ],
};

const phaseNames = [
  "shell",
  "floors and ceilings",
  "openings",
  "surfaces",
  "props",
  "lighting",
  "ambient effects",
];

function studioAnswering(phaseReply: (code: string) => string) {
  return new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const code = String(request.arguments["code"]);
      const text = code.includes('"phase":"') ? phaseReply(code) : '{"snapshotTaken":false}';
      return { content: [{ type: "text", text }] };
    },
  });
}

function build(studio: FakeStudioConnection, spec: object) {
  return buildMapTool.handler(buildMapTool.inputSchema.parse(spec), { studio });
}

await test("a spec that cannot be built fails before Studio is asked", async () => {
  const studio = studioAnswering(() => "{}");
  const lost = {
    mapId: "lost",
    rooms: [
      {
        name: "hall",
        width: 40,
        depth: 40,
        relation: { to: "nowhere", direction: "east", hallwayLength: 10, hallwayWidth: 8 },
      },
    ],
  };
  await assert.rejects(build(studio, lost), /unknown room "nowhere"/);
  await assert.rejects(
    build(studio, { ...twoRoomSpec, style: { preset: "nowhere" } }),
    /Unknown style preset "nowhere"/,
  );
  assert.equal(studio.requests.length, 0);
});

await test("a phase failure names the phase and keeps Studio's message", async () => {
  const studio = new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const isSurfaces = String(request.arguments["code"]).includes('"phase":"surfaces"');
      return {
        content: [{ type: "text", text: isSurfaces ? "boom" : '{"partCount":1}' }],
        isError: isSurfaces,
      };
    },
  });
  await assert.rejects(
    build(studio, { ...twoRoomSpec, style: { preset: "train-station" } }),
    /failed in the "surfaces" phase.*boom/,
  );
  assert.equal(studio.requests.length, 4);
});

await test("a build reports progress after each phase and returns the plan's numbers", async () => {
  const progress: [number, number, string][] = [];
  const studio = studioAnswering(() => '{"partCount":14}');
  const result = await buildMapTool.handler(buildMapTool.inputSchema.parse(twoRoomSpec), {
    studio,
    reportProgress: (done, total, message) => {
      progress.push([done, total, message]);
      return Promise.resolve();
    },
  });
  assert.deepEqual(
    progress,
    phaseNames.map((name, index) => [index + 1, 7, name]),
  );
  const structured = buildMapTool.outputSchema.parse(result.structuredContent);
  assert.equal(structured.partCount, 14);
  assert.deepEqual(
    structured.phases.map((phase) => phase.name),
    phaseNames,
  );
});

await test("a committed hero mesh that fails to load becomes a warning and its set piece is built instead", async () => {
  const trainStation = (await loadPresets()).get("train-station");
  assert.ok(trainStation !== undefined);
  const { assetId } = await recordedHeroAsset(trainStation, "bench");
  assert.ok(assetId !== undefined, "hero-assets.json records the bench");
  const failures = JSON.stringify([{ kind: "bench", assetId, error: "HTTP 403" }]);
  const studio = studioAnswering((code) =>
    code.includes('"phase":"props"')
      ? `{"partCount":14,"heroLoadFailures":${failures}}`
      : '{"partCount":14}',
  );
  const benchmark = JSON.parse(
    await readFile(new URL("../../eval/benchmarks/train-station.json", import.meta.url), "utf8"),
  ) as object;
  const result = await build(studio, { ...benchmark, useRecordedAssets: true });
  const { warnings } = buildMapTool.outputSchema.parse(result.structuredContent);
  const failure = warnings.filter((warning) => warning.includes("failed to load"));
  assert.equal(failure.length, 1);
  assert.match(
    failure[0] ?? "",
    new RegExp(`bench \\(asset ${assetId}\\) failed to load: HTTP 403`),
  );
  assert.match(failure[0] ?? "", /its bench set piece is built instead\.$/);
});
