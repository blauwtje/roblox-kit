import assert from "node:assert/strict";
import { test } from "node:test";
import { relationMapSpecSchema } from "./map-spec.ts";
import { planMap } from "./build-plan.ts";

const rooms = [
  { name: "start", x: 0, z: 0, width: 40, depth: 40, spawn: true, doors: [{ side: "east" }] },
  { name: "hall", x: 40, z: 0, width: 40, depth: 40, doors: [{ side: "west" }] },
];

function inputOf(extra: object = {}, useRecordedAssets = false) {
  return {
    ...relationMapSpecSchema.parse({ mapId: "plan-map", rooms, ...extra }),
    useRecordedAssets,
  };
}

await test("a plan names the seven phases in order and their part counts without touching Studio", async () => {
  const plan = await planMap(inputOf(), {});
  assert.deepEqual(
    plan.phases.map((phase) => phase.name),
    [
      "shell",
      "floors and ceilings",
      "openings",
      "surfaces",
      "props",
      "lighting",
      "ambient effects",
    ],
  );
  assert.deepEqual(
    plan.phaseSizes,
    plan.phases.map((phase) => ({ name: phase.name, partCount: phase.parts.length })),
  );
  assert.deepEqual(
    plan.zones.map((zone) => zone.name),
    ["start", "hall"],
  );
  assert.equal(plan.recorded, false);
  assert.equal(plan.texturePixels, 0);
});

await test("a styled plan with recorded assets off carries no hero, trim or pendant meshes and flat variants", async () => {
  const plan = await planMap(inputOf({ style: { preset: "train-station" } }), {});
  assert.equal(plan.recorded, false);
  assert.deepEqual(plan.build.heroProps, []);
  assert.deepEqual(plan.build.trimMeshes, []);
  assert.deepEqual(plan.build.pendantMeshes, []);
  assert.ok(plan.lighting !== undefined);
  for (const variant of Object.values(plan.build.variants)) {
    assert.equal(variant.maps, undefined);
  }
  assert.ok(plan.phases.find((phase) => phase.name === "props")?.parts.length);
});

await test("a plan rejects a room type the style does not declare before anything else", async () => {
  await assert.rejects(
    planMap(inputOf({ rooms: [{ ...rooms[0], roomType: "nowhere" }] }), {}),
    /Room "start" has room type "nowhere"/,
  );
});
