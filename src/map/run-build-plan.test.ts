import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { relationMapSpecSchema } from "./map-spec.ts";
import { planMap, type BuildPlan } from "./build-plan.ts";
import { heroLoadWarning, runBuildPlan } from "./run-build-plan.ts";

const studios = [{ id: "studio-a", name: "Place A" }];

const rooms = [
  { name: "start", x: 0, z: 0, width: 40, depth: 40, spawn: true, doors: [{ side: "east" }] },
  { name: "hall", x: 40, z: 0, width: 40, depth: 40, doors: [{ side: "west" }] },
];

const plan = await planMap(
  { ...relationMapSpecSchema.parse({ mapId: "run-map", rooms }), useRecordedAssets: false },
  {},
);

function withBuild(build: Partial<BuildPlan["build"]>): BuildPlan {
  return { ...plan, build: { ...plan.build, ...build } };
}

const heroSlot = { kind: "ticket-counter", assetId: "1", pivot: { x: 0, y: 0, z: 0 } };

await test("runBuildPlan runs the phases in order, reports progress and sums the warnings", async () => {
  const studio = new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const code = String(request.arguments["code"]);
      const text = code.includes('"phase":"') ? '{"partCount":9}' : '{"snapshotTaken":false}';
      return { content: [{ type: "text", text }] };
    },
  });
  const progress: string[] = [];
  const result = await runBuildPlan(
    { ...plan, warnings: ["planned"] },
    {
      studio,
      reportProgress: (step, total, name) => {
        progress.push(`${String(step)}/${String(total)} ${name}`);
        return Promise.resolve();
      },
    },
  );
  assert.equal(result.partCount, 9);
  assert.deepEqual(result.warnings, ["planned"]);
  assert.equal(progress.length, 7);
  assert.equal(progress[0], "1/7 shell");
  assert.equal(studio.requests.length, 8);
});

await test("runBuildPlan names the phase a failure stopped in", async () => {
  const studio = new FakeStudioConnection(studios, {
    execute_luau: () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
  });
  await assert.rejects(
    runBuildPlan(plan, { studio }),
    /Building map "run-map" failed in the "shell" phase; the Model may be partial/,
  );
});

await test("heroLoadWarning says nothing is built for a hero prop with no fallback", () => {
  const hero = { ...heroSlot, fit: "none" } as unknown as BuildPlan["build"]["heroProps"][number];
  const result = heroLoadWarning(
    { kind: "train-car", assetId: "1", error: "HTTP 403" },
    withBuild({ heroProps: [hero] }),
  );
  assert.equal(
    result.warning,
    "Hero prop train-car (asset 1) failed to load: HTTP 403; nothing is built in its place.",
  );
  assert.equal(result.pendantMeshFailed, false);
});

await test("heroLoadWarning names the fallback set piece of a hero prop that has one", () => {
  const hero = {
    ...heroSlot,
    fallback: { kind: "ticket-counter" },
  } as unknown as BuildPlan["build"]["heroProps"][number];
  const result = heroLoadWarning(
    { kind: "ticket-counter", assetId: "1", error: "HTTP 403" },
    withBuild({ heroProps: [hero] }),
  );
  assert.match(result.warning, /its ticket-counter set piece is built instead\.$/);
  assert.equal(result.pendantMeshFailed, false);
});

await test("heroLoadWarning flags a failed pendant mesh and names the kit fixture box", () => {
  const pendant = {
    kind: "pendant",
    assetId: "7",
  } as unknown as BuildPlan["build"]["pendantMeshes"][number];
  const result = heroLoadWarning(
    { kind: "pendant", assetId: "7", error: "HTTP 500" },
    withBuild({ pendantMeshes: [pendant] }),
  );
  assert.equal(
    result.warning,
    "Pendant mesh (asset 7) failed to load: HTTP 500; its kit fixture box is built instead.",
  );
  assert.equal(result.pendantMeshFailed, true);
});

await test("heroLoadWarning names the kit trim for a failed trim mesh", () => {
  const trim = {
    kind: "baseboard",
    assetId: "9",
  } as unknown as BuildPlan["build"]["trimMeshes"][number];
  const result = heroLoadWarning(
    { kind: "baseboard", assetId: "9", error: "HTTP 404" },
    withBuild({ trimMeshes: [trim] }),
  );
  assert.equal(
    result.warning,
    "Trim mesh baseboard (asset 9) failed to load: HTTP 404; its kit trim is built instead.",
  );
});
