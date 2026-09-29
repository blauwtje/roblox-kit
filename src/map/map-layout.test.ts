import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { layoutMap } from "./map-layout.ts";
import type { PartRecord } from "./map-layout.ts";
import { mapSpecSchema } from "./map-spec.ts";

const threeRoomInput = {
  mapId: "three-rooms",
  rooms: [
    {
      name: "start",
      x: 0,
      z: 0,
      width: 40,
      depth: 40,
      spawn: true,
      doors: [{ side: "east", offset: 0 }],
    },
    {
      name: "hall",
      x: 40,
      z: 0,
      width: 40,
      depth: 40,
      doors: [{ side: "west" }, { side: "north", offset: 5 }],
    },
    { name: "vault", x: 40, z: -40, width: 40, depth: 40, doors: [{ side: "south", offset: 5 }] },
  ],
  terrain: [
    {
      shape: "block",
      center: { x: 0, y: -10, z: 0 },
      size: { x: 200, y: 20, z: 200 },
      material: "Grass",
    },
    { shape: "ball", center: { x: 60, y: -5, z: 60 }, radius: 8, material: "Water" },
  ],
};

function layoutOf(input: unknown) {
  return layoutMap(mapSpecSchema.parse(input));
}

function partNamed(parts: PartRecord[], name: string): PartRecord {
  const part = parts.find((candidate) => candidate.name === name);
  assert.ok(part, `part ${name} exists`);
  return part;
}

await test("the same spec lays out to the same parts and terrain fills", () => {
  const first = layoutOf(threeRoomInput);
  const second = layoutOf(structuredClone(threeRoomInput));
  assert.deepEqual(first, second);
  assert.equal(new Set(first.parts.map((part) => part.name)).size, first.parts.length);
});

await test("a room gets a floor under y = 0 and walls standing on it with the config defaults", () => {
  const { parts } = layoutOf({
    mapId: "one",
    rooms: [{ name: "box", x: 10, z: 20, width: 30, depth: 20 }],
  });
  const floor = partNamed(parts, "box-floor");
  assert.deepEqual(floor.position, { x: 10, y: -0.5, z: 20 });
  assert.deepEqual(floor.size, { x: 30, y: config.defaultWallThicknessStuds, z: 20 });
  assert.equal(floor.material, config.defaultFloorMaterial);
  const north = partNamed(parts, "box-wall-north-1");
  assert.deepEqual(north.position, { x: 10, y: 6, z: 10.5 });
  assert.deepEqual(north.size, { x: 30, y: config.defaultWallHeightStuds, z: 1 });
  assert.equal(north.material, config.defaultWallMaterial);
  const east = partNamed(parts, "box-wall-east-1");
  assert.deepEqual(east.position, { x: 24.5, y: 6, z: 20 });
  assert.deepEqual(east.size, { x: 1, y: 12, z: 18 });
  assert.equal(parts.length, 5);
});

await test("a door splits its wall into two stretches with a gap of the door width", () => {
  const { parts } = layoutOf({
    mapId: "door",
    rooms: [
      { name: "box", x: 0, z: 0, width: 40, depth: 40, doors: [{ side: "south", offset: 4 }] },
    ],
  });
  const left = partNamed(parts, "box-wall-south-1");
  const right = partNamed(parts, "box-wall-south-2");
  assert.deepEqual(left.position, { x: -9.5, y: 6, z: 19.5 });
  assert.deepEqual(left.size, { x: 21, y: 12, z: 1 });
  assert.deepEqual(right.position, { x: 13.5, y: 6, z: 19.5 });
  assert.deepEqual(right.size, { x: 13, y: 12, z: 1 });
  const gap = right.position.x - right.size.x / 2 - (left.position.x + left.size.x / 2);
  assert.equal(gap, config.defaultDoorWidthStuds);
});

await test("a door at the wall end leaves one stretch", () => {
  const { parts } = layoutOf({
    mapId: "corner",
    rooms: [
      { name: "box", x: 0, z: 0, width: 40, depth: 40, doors: [{ side: "north", offset: -17 }] },
    ],
  });
  const north = parts.filter((part) => part.name.startsWith("box-wall-north"));
  assert.equal(north.length, 1);
  assert.deepEqual(north[0]?.size, { x: 34, y: 12, z: 1 });
});

await test("room and map settings override the defaults, room over map", () => {
  const { parts } = layoutOf({
    mapId: "styled",
    wallMaterial: "Wood",
    wallHeight: 20,
    rooms: [
      { name: "plain", x: 0, z: 0, width: 20, depth: 20 },
      { name: "tall", x: 30, z: 0, width: 20, depth: 20, wallHeight: 30, floorMaterial: "Marble" },
    ],
  });
  assert.equal(partNamed(parts, "plain-wall-north-1").material, "Wood");
  assert.equal(partNamed(parts, "plain-wall-north-1").size.y, 20);
  assert.equal(partNamed(parts, "tall-wall-north-1").size.y, 30);
  assert.equal(partNamed(parts, "tall-floor").material, "Marble");
  assert.equal(partNamed(parts, "plain-floor").material, config.defaultFloorMaterial);
});

await test("a spawn room gets a spawn pad on its floor at the room center", () => {
  const { parts } = layoutOf(threeRoomInput);
  const spawns = parts.filter((part) => part.kind === "spawn");
  assert.deepEqual(
    spawns.map((part) => part.name),
    ["start-spawn"],
  );
  assert.deepEqual(spawns[0]?.position, { x: 0, y: 0.5, z: 0 });
});

await test("terrain fills pass through in order", () => {
  const { terrainFills } = layoutOf(threeRoomInput);
  assert.deepEqual(terrainFills, mapSpecSchema.parse(threeRoomInput).terrain);
  assert.deepEqual(
    terrainFills.map((fill) => fill.shape),
    ["block", "ball"],
  );
});

await test("a door that does not fit the wall or overlaps another is rejected with the room name", () => {
  assert.throws(
    () =>
      layoutOf({
        mapId: "bad",
        rooms: [
          { name: "box", x: 0, z: 0, width: 40, depth: 40, doors: [{ side: "north", offset: 19 }] },
        ],
      }),
    /Room "box": the north door/,
  );
  assert.throws(
    () =>
      layoutOf({
        mapId: "bad",
        rooms: [
          {
            name: "box",
            x: 0,
            z: 0,
            width: 40,
            depth: 40,
            doors: [
              { side: "east", offset: 0 },
              { side: "east", offset: 3 },
            ],
          },
        ],
      }),
    /Room "box": the east door/,
  );
});

await test("a room no larger than its walls is rejected", () => {
  assert.throws(
    () => layoutOf({ mapId: "tiny", rooms: [{ name: "box", x: 0, z: 0, width: 2, depth: 40 }] }),
    /Room "box" is 2 by 40 studs/,
  );
});

await test("the schema rejects unknown keys, duplicate room names and empty maps", () => {
  assert.equal(mapSpecSchema.safeParse({ ...threeRoomInput, extra: 1 }).success, false);
  assert.equal(mapSpecSchema.safeParse({ mapId: "empty", rooms: [] }).success, false);
  const room = { name: "same", x: 0, z: 0, width: 20, depth: 20 };
  const duplicate = mapSpecSchema.safeParse({ mapId: "dup", rooms: [room, room] });
  assert.equal(duplicate.success, false);
  assert.equal(
    mapSpecSchema.safeParse({ mapId: "bad", rooms: [{ ...room, width: -5 }] }).success,
    false,
  );
});
