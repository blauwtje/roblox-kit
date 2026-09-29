import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { test } from "node:test";
import { loadPresets } from "../style/load-preset.ts";
import { mapSpecSchema } from "./map-spec.ts";
import type { MapSpec } from "./map-spec.ts";
import { placeProps, propKinds } from "./prop-placement.ts";
import type { PropRecord } from "./prop-placement.ts";

const kit = ["bench", "lamp", "pillar", "stairs", "rail"];
const setPieceKit = [
  "track-bed",
  "platform-edge",
  "counter",
  "sign",
  "lab-bench",
  "cell-bars",
  "control-console",
  "crate-stack",
  "fireplace",
  "departure-board",
  "clock",
  "ticket-counter",
];

const hallSpec = mapSpecSchema.parse({
  mapId: "props",
  rooms: [
    {
      name: "hall",
      x: 10,
      z: -20,
      width: 60,
      depth: 40,
      doors: [{ side: "north", offset: 5 }],
    },
    { name: "closet", x: 100, z: 0, width: 8, depth: 8 },
  ],
});

function propsIn(spec: MapSpec, room: string, props: PropRecord[]): PropRecord[] {
  const target = spec.rooms.find((candidate) => candidate.name === room);
  assert.ok(target, `room ${room} exists`);
  return props.filter(
    (prop) =>
      Math.abs(prop.pivot.x - target.x) <= target.width / 2 &&
      Math.abs(prop.pivot.z - target.z) <= target.depth / 2,
  );
}

await test("the same spec, kit and seed give the same props", () => {
  assert.deepEqual(placeProps(hallSpec, kit, 3), placeProps(hallSpec, kit, 3));
});

await test("another seed gives other props", () => {
  assert.notDeepEqual(placeProps(hallSpec, kit, 3), placeProps(hallSpec, kit, 4));
});

await test("every prop is a bundled kind, stands on the floor and has an integer seed", () => {
  const props = placeProps(hallSpec, kit, 1);
  assert.ok(props.length > 0);
  for (const prop of props) {
    assert.ok(propKinds.includes(prop.kind), prop.kind);
    assert.equal(prop.pivot.y, prop.size.y / 2, `${prop.kind} rests on y = 0`);
    assert.ok(Number.isInteger(prop.seed) && prop.seed >= 0, `${prop.kind} seed`);
  }
});

await test("props stay inside their room's walls", () => {
  const props = placeProps(hallSpec, kit, 1);
  const wallThickness = 1;
  for (const prop of propsIn(hallSpec, "hall", props)) {
    assert.ok(
      Math.abs(prop.pivot.x - 10) + prop.size.x / 2 <= 30 - wallThickness,
      `${prop.kind} x`,
    );
    assert.ok(
      Math.abs(prop.pivot.z + 20) + prop.size.z / 2 <= 20 - wallThickness,
      `${prop.kind} z`,
    );
  }
});

await test("props do not overlap each other or block the doorway", () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const props = placeProps(hallSpec, kit, seed);
    for (const [index, prop] of props.entries()) {
      for (const other of props.slice(index + 1)) {
        const apartX = Math.abs(prop.pivot.x - other.pivot.x) >= (prop.size.x + other.size.x) / 2;
        const apartZ = Math.abs(prop.pivot.z - other.pivot.z) >= (prop.size.z + other.size.z) / 2;
        assert.ok(apartX || apartZ, `seed ${String(seed)}: ${prop.kind} overlaps ${other.kind}`);
      }
      // The door is 6 studs wide (the config default) at x = 15 in the north wall at z = -40.
      const beforeDoor =
        Math.abs(prop.pivot.x - 15) < 3 + prop.size.x / 2 &&
        prop.pivot.z - prop.size.z / 2 < -40 + 8;
      assert.ok(!beforeDoor, `seed ${String(seed)}: ${prop.kind} blocks the door`);
    }
  }
});

await test("a room too small for a prop gets none", () => {
  assert.equal(propsIn(hallSpec, "closet", placeProps(hallSpec, kit, 1)).length, 0);
});

await test("a pillar is as tall as the wall and a lamp never taller", () => {
  const spec = mapSpecSchema.parse({
    mapId: "tall",
    wallHeight: 6,
    rooms: [{ name: "room", x: 0, z: 0, width: 80, depth: 80 }],
  });
  for (const prop of placeProps(spec, ["pillar", "lamp"], 2)) {
    assert.ok(prop.size.y <= 6, prop.kind);
    if (prop.kind === "pillar") {
      assert.equal(prop.size.y, 6);
    }
  }
});

await test("props of a north wall run along X and props of an east wall run along Z", () => {
  const spec = mapSpecSchema.parse({
    mapId: "orient",
    rooms: [{ name: "room", x: 0, z: 0, width: 80, depth: 80 }],
  });
  const benches = placeProps(spec, ["bench"], 5);
  assert.ok(benches.length > 0);
  for (const bench of benches) {
    const againstZWall = Math.abs(bench.pivot.z) > Math.abs(bench.pivot.x);
    assert.equal(
      bench.size.x > bench.size.z,
      againstZWall,
      `bench at ${JSON.stringify(bench.pivot)}`,
    );
  }
});

await test("an empty kit places nothing and an unknown kind throws", () => {
  assert.deepEqual(placeProps(hallSpec, [], 1), []);
  assert.throws(() => placeProps(hallSpec, ["market-stall"], 1), /market-stall.*no generator/);
});

await test("every bundled preset's prop kit names only kinds with a generator", async () => {
  const presets = await loadPresets();
  for (const [name, preset] of presets) {
    for (const entry of preset.propKit) {
      assert.ok((propKinds as readonly string[]).includes(entry), `${name}: ${entry}`);
    }
    assert.doesNotThrow(() => placeProps(hallSpec, preset.propKit, 1), name);
  }
});

await test("every prop kind has a generator source in luau/props", async () => {
  for (const kind of propKinds) {
    await access(new URL(`../../luau/props/${kind}.luau`, import.meta.url));
  }
});

await test("the set-piece kinds are placed inside the room like any other prop", () => {
  const spec = mapSpecSchema.parse({
    mapId: "set-pieces",
    rooms: [{ name: "room", x: 0, z: 0, width: 80, depth: 80 }],
  });
  const props = placeProps(spec, setPieceKit, 1);
  assert.ok(props.length > 0);
  for (const prop of props) {
    assert.ok(setPieceKit.includes(prop.kind), prop.kind);
    assert.ok(Math.abs(prop.pivot.x) + prop.size.x / 2 <= 39, `${prop.kind} x`);
    assert.ok(Math.abs(prop.pivot.z) + prop.size.z / 2 <= 39, `${prop.kind} z`);
  }
});
