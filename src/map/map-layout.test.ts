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

await test("a room floor's top clears the ground plane y = 0 by less than the overlap tolerance", () => {
  const { parts } = layoutOf({
    mapId: "one",
    rooms: [{ name: "box", x: 10, z: 20, width: 30, depth: 20 }],
  });
  const floor = partNamed(parts, "box-floor");
  const floorTop = floor.position.y + floor.size.y / 2;
  assert.ok(floorTop > 0, `floor top ${String(floorTop)} is above the Baseplate top at y = 0`);
  assert.ok(
    floorTop < config.overlapToleranceStuds,
    "walls and props on y = 0 only touch the floor",
  );
});

await test("a room gets a floor topped at y = 0 plus the lift and walls standing on it with the config defaults", () => {
  const { parts } = layoutOf({
    mapId: "one",
    rooms: [{ name: "box", x: 10, z: 20, width: 30, depth: 20 }],
  });
  const floor = partNamed(parts, "box-floor");
  assert.deepEqual(floor.position, { x: 10, y: config.floorLiftStuds - 0.5, z: 20 });
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

await test("each part carries a surface role and the shipped default color when there is no style", () => {
  const { parts } = layoutOf(threeRoomInput);
  for (const part of parts) {
    assert.match(part.color, /^#[0-9a-f]{6}$/);
  }
  const floor = partNamed(parts, "start-floor");
  const wall = partNamed(parts, "start-wall-north-1");
  const spawn = partNamed(parts, "start-spawn");
  assert.equal(floor.role, "floor");
  assert.equal(wall.role, "wall");
  assert.equal(spawn.role, "floor");
  assert.notEqual(floor.color, wall.color);
});

await test("a style's surface colors replace the defaults by role", () => {
  const surfaces = { floor: { color: "#112233" }, wall: { color: "#445566" } };
  const { parts } = layoutMap(mapSpecSchema.parse(threeRoomInput), surfaces);
  assert.equal(partNamed(parts, "hall-floor").color, "#112233");
  assert.equal(partNamed(parts, "start-spawn").color, "#112233");
  assert.equal(partNamed(parts, "hall-wall-north-1").color, "#445566");
});

await test("a style's surface material fills in where the room and the map name none", () => {
  const surfaces = {
    floor: { color: "#112233", material: "Slate" },
    wall: { color: "#445566", material: "Brick" },
  };
  const input = { ...threeRoomInput, wallMaterial: "Wood" };
  const { parts } = layoutMap(mapSpecSchema.parse(input), surfaces);
  assert.equal(partNamed(parts, "hall-floor").material, "Slate");
  assert.equal(partNamed(parts, "start-spawn").material, "Slate");
  assert.equal(partNamed(parts, "hall-wall-north-1").material, "Wood");
  const withoutMapMaterial = layoutMap(mapSpecSchema.parse(threeRoomInput), surfaces);
  assert.equal(partNamed(withoutMapMaterial.parts, "hall-wall-north-1").material, "Brick");
});

await test("a layout without the ceilings option has no ceiling part", () => {
  const { parts } = layoutOf(threeRoomInput);
  assert.equal(parts.filter((part) => part.kind === "ceiling").length, 0);
});

await test("ceilings add one slab per room on top of the walls, with shipped defaults", () => {
  const spec = mapSpecSchema.parse({ ...threeRoomInput, wallHeight: 10, wallThickness: 2 });
  const { parts } = layoutMap(spec, undefined, { ceilings: true });
  const ceilings = parts.filter((part) => part.kind === "ceiling");
  assert.deepEqual(
    ceilings.map((part) => part.name),
    ["start", "hall", "vault"].map((room) => `${room}${config.ceilingNameSuffix}`),
  );
  const ceiling = partNamed(parts, "hall-ceiling");
  assert.equal(ceiling.room, "hall");
  assert.equal(ceiling.role, "ceiling");
  assert.equal(ceiling.material, config.defaultCeilingMaterial);
  assert.deepEqual(ceiling.position, { x: 40, y: 11, z: 0 });
  assert.deepEqual(ceiling.size, { x: 40, y: 2, z: 40 });
  const wall = partNamed(parts, "hall-wall-north-1");
  assert.equal(ceiling.position.y - ceiling.size.y / 2, wall.position.y + wall.size.y / 2);
  assert.equal(new Set(parts.map((part) => part.name)).size, parts.length);
});

await test("ceilings take the style's ceiling color and material", () => {
  const surfaces = {
    floor: { color: "#112233" },
    wall: { color: "#445566" },
    ceiling: { color: "#778899", material: "Metal" },
  };
  const { parts } = layoutMap(mapSpecSchema.parse(threeRoomInput), surfaces, { ceilings: true });
  assert.equal(partNamed(parts, "vault-ceiling").color, "#778899");
  assert.equal(partNamed(parts, "vault-ceiling").material, "Metal");
});

await test("the ceiling tag is a non-empty config name", () => {
  assert.ok(config.ceilingTag.length > 0);
});
