import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { layoutMap } from "./map-layout.ts";
import { relationMapSpecSchema } from "./map-spec.ts";
import type { RoomSpec } from "./map-spec.ts";
import { resolveRelations } from "./relation-solver.ts";

/** Beside the hallway line, not on it: a lab 25 east of the hub overlaps it, one further east does not. */
const sideBlocker = { name: "blocker", x: 25, z: 8, width: 10, depth: 10 };
const hub = { name: "hub", x: 0, z: 0, width: 20, depth: 20 };

function relatedRoom(
  name: string,
  to: string,
  direction: string,
  hallwayLength: number,
  size = 10,
  hallwayWidth = 6,
) {
  return {
    name,
    width: size,
    depth: size,
    relation: { to, direction, hallwayLength, hallwayWidth },
  };
}

function resolve(rooms: object[]) {
  return resolveRelations(relationMapSpecSchema.parse({ mapId: "m", rooms }));
}

function roomsOverlapInTest(first: RoomSpec, second: RoomSpec) {
  const overlapX =
    Math.min(first.x + first.width / 2, second.x + second.width / 2) -
    Math.max(first.x - first.width / 2, second.x - second.width / 2);
  const overlapZ =
    Math.min(first.z + first.depth / 2, second.z + second.depth / 2) -
    Math.max(first.z - first.depth / 2, second.z - second.depth / 2);
  return overlapX > config.overlapToleranceStuds && overlapZ > config.overlapToleranceStuds;
}

function roomNamed(rooms: RoomSpec[], name: string) {
  const room = rooms.find((candidate) => candidate.name === name);
  assert.ok(room, `room ${name} exists`);
  return room;
}

await test("a spec of placed rooms resolves to the same rooms", () => {
  const spec = relationMapSpecSchema.parse({
    mapId: "m",
    rooms: [hub, { ...hub, name: "b", x: 40 }],
  });
  assert.deepEqual(resolveRelations(spec).rooms, spec.rooms);
});

await test("an east room snaps outward to the grid and gets a hallway with matching doors", () => {
  const { rooms } = resolve([hub, relatedRoom("lab", "hub", "east", 7)]);
  assert.deepEqual(
    rooms.map((room) => room.name),
    ["hub", "lab", "hub-lab-hallway"],
  );
  // The east edge is 10 and 7 studs of hallway plus half the room reach 22, which snaps up to 25.
  const lab = roomNamed(rooms, "lab");
  assert.deepEqual([lab.x, lab.z], [25, 0]);
  const hallway = roomNamed(rooms, "hub-lab-hallway");
  assert.deepEqual([hallway.x, hallway.z, hallway.width, hallway.depth], [15, 0, 10, 6]);
  assert.deepEqual(hallway.doors, [
    { side: "west", offset: 0 },
    { side: "east", offset: 0 },
  ]);
  assert.deepEqual(roomNamed(rooms, "hub").doors, [{ side: "east", offset: 0 }]);
  assert.deepEqual(lab.doors, [{ side: "west", offset: 0 }]);
});

await test("west and north rooms snap down and away from the target", () => {
  const { rooms } = resolve([
    hub,
    relatedRoom("west-room", "hub", "west", 7),
    relatedRoom("north-room", "hub", "north", 10, 20, 8),
  ]);
  const west = roomNamed(rooms, "west-room");
  assert.deepEqual([west.x, west.z], [-25, 0]);
  const north = roomNamed(rooms, "north-room");
  assert.deepEqual([north.x, north.z], [0, -30]);
  const hallway = roomNamed(rooms, "hub-north-room-hallway");
  assert.deepEqual([hallway.x, hallway.z, hallway.width, hallway.depth], [0, -15, 8, 10]);
  assert.deepEqual(north.doors, [{ side: "south", offset: 0 }]);
});

await test("a room off the grid is centered on the nearest grid line and its door lines up with the hallway", () => {
  const { rooms } = resolve([{ ...hub, z: 3 }, relatedRoom("lab", "hub", "east", 10)]);
  const lab = roomNamed(rooms, "lab");
  assert.equal(lab.z, 5);
  assert.deepEqual(lab.doors, [{ side: "west", offset: -2 }]);
  assert.equal(roomNamed(rooms, "hub-lab-hallway").z, 3);
});

await test("rooms resolve after the room they relate to and hallways come last", () => {
  const { rooms } = resolve([
    relatedRoom("c", "b", "south", 10),
    relatedRoom("b", "a", "east", 10),
    { ...hub, name: "a" },
  ]);
  assert.deepEqual(
    rooms.map((room) => room.name),
    ["a", "b", "c", "a-b-hallway", "b-c-hallway"],
  );
});

await test("the hallway door is narrowed to fit a narrow hallway between its walls", () => {
  const { rooms } = resolve([hub, relatedRoom("lab", "hub", "east", 10, 10, 4)]);
  assert.equal(
    roomNamed(rooms, "hub-lab-hallway").doorWidth,
    4 - 2 * config.defaultWallThicknessStuds,
  );
});

await test("a resolved spec lays out without a door or overlap error", () => {
  const spec = resolve([
    hub,
    relatedRoom("lab", "hub", "east", 7),
    relatedRoom("vault", "lab", "south", 12),
  ]);
  assert.ok(layoutMap(spec).parts.length > 0);
});

await test("a cycle, an unknown target and a self relation name the rooms", () => {
  assert.throws(
    () => resolve([relatedRoom("a", "b", "east", 10), relatedRoom("b", "a", "east", 10)]),
    /a -> b -> a/,
  );
  assert.throws(
    () => resolve([relatedRoom("a", "ghost", "east", 10)]),
    /"a".*unknown room "ghost"/,
  );
  assert.throws(() => resolve([relatedRoom("a", "a", "east", 10)]), /a -> a/);
});

await test("a room that lands on another room moves along its hallway and keeps its relation", () => {
  const rooms = [hub, sideBlocker, relatedRoom("lab", "hub", "east", 10)];
  const resolved = resolve(rooms).rooms;
  const lab = roomNamed(resolved, "lab");
  const blocker = roomNamed(resolved, "blocker");
  assert.ok(lab.x - lab.width / 2 >= blocker.x + blocker.width / 2 - config.overlapToleranceStuds);
  assert.ok(lab.x > 0, "the lab stays east of the hub");
  assert.ok(layoutMap({ mapId: "m", rooms: resolved } as never).parts.length > 0);
  assert.deepEqual(resolve(rooms).rooms, resolved);
});

await test("a chain of related rooms stays clear of a blocker and keeps its directions", () => {
  const rooms = [
    hub,
    { ...hub, name: "blocker", x: 25, z: 30, width: 20, depth: 20 },
    relatedRoom("lab", "hub", "east", 10),
    relatedRoom("vault", "lab", "south", 5),
  ];
  const resolved = resolve(rooms).rooms;
  const pieces = resolved.filter((room) => room.name !== "hub" && room.name !== "blocker");
  for (const piece of pieces) {
    assert.ok(
      !roomsOverlapInTest(piece, roomNamed(resolved, "blocker")),
      `${piece.name} stays clear of the blocker`,
    );
  }
  assert.ok(roomNamed(resolved, "vault").z > roomNamed(resolved, "lab").z, "the vault stays south");
});

await test("a room with no free pose is an error naming the overlap", () => {
  const wall = { ...hub, name: "blocker", x: 60, z: 0, width: 100, depth: 200 };
  assert.throws(
    () => resolve([hub, wall, relatedRoom("lab", "hub", "east", 10)]),
    /"blocker" and "lab" overlap/,
  );
});

await test("the same seed gives the same poses", () => {
  const rooms = [
    hub,
    sideBlocker,
    { ...sideBlocker, name: "second", z: -8 },
    relatedRoom("lab", "hub", "east", 10),
  ];
  const spec = { mapId: "m", seed: 7, rooms };
  const first = resolveRelations(relationMapSpecSchema.parse(spec));
  const second = resolveRelations(relationMapSpecSchema.parse(spec));
  assert.deepEqual(first.rooms, second.rooms);
});

await test("a hallway named like an existing room is an error", () => {
  assert.throws(
    () =>
      resolve([
        hub,
        { ...hub, name: "hub-lab-hallway", x: 200 },
        relatedRoom("lab", "hub", "east", 10),
      ]),
    /hub-lab-hallway/,
  );
});

await test("a hallway too narrow for any door is an error", () => {
  assert.throws(() => resolve([hub, relatedRoom("lab", "hub", "east", 10, 10, 2)]), /too narrow/);
});

await test("overlapping placed rooms without relations still resolve unchanged", () => {
  const spec = relationMapSpecSchema.parse({
    mapId: "m",
    rooms: [hub, { ...hub, name: "b", x: 5 }],
  });
  assert.deepEqual(resolveRelations(spec).rooms, spec.rooms);
});
