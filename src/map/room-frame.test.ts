import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { mapSpecSchema } from "./map-spec.ts";
import { pointOnWall, rotatedHalfExtents, roomFrame, runsAlongX, wallBox } from "./room-frame.ts";

const spec = mapSpecSchema.parse({
  mapId: "m",
  wallThickness: 2,
  rooms: [{ name: "hall", x: 100, z: 50, width: 40, depth: 20, doorWidth: 6 }],
});
const room = spec.rooms[0] as (typeof spec.rooms)[number];
const frame = roomFrame(spec, room);

await test("the frame takes its measures from measureRoom", () => {
  assert.equal(frame.halfWidth, 18);
  assert.equal(frame.halfDepth, 8);
  assert.equal(frame.wallThickness, 2);
  assert.equal(frame.doorWidth, 6);
  assert.equal(frame.wallHeight, config.defaultWallHeightStuds);
});

await test("runsAlongX is true for north and south only", () => {
  assert.deepEqual((["north", "south", "east", "west"] as const).map(runsAlongX), [
    true,
    true,
    false,
    false,
  ]);
});

await test("wallBox spans depth studs in from each inner face", () => {
  assert.deepEqual(wallBox(frame, "north", { alongMin: -1, alongMax: 1, depth: 3 }), {
    minX: 99,
    maxX: 101,
    minZ: 42,
    maxZ: 45,
  });
  assert.deepEqual(wallBox(frame, "south", { alongMin: -1, alongMax: 1, depth: 3 }), {
    minX: 99,
    maxX: 101,
    minZ: 55,
    maxZ: 58,
  });
  assert.deepEqual(wallBox(frame, "west", { alongMin: -1, alongMax: 1, depth: 3 }), {
    minX: 82,
    maxX: 85,
    minZ: 49,
    maxZ: 51,
  });
  assert.deepEqual(wallBox(frame, "east", { alongMin: -1, alongMax: 1, depth: 3 }), {
    minX: 115,
    maxX: 118,
    minZ: 49,
    maxZ: 51,
  });
});

await test("pointOnWall insets from the inner face", () => {
  assert.deepEqual(pointOnWall(frame, "north", { along: 4, inset: 1 }), { x: 104, z: 43 });
  assert.deepEqual(pointOnWall(frame, "south", { along: 4, inset: 1 }), { x: 104, z: 57 });
  assert.deepEqual(pointOnWall(frame, "west", { along: 4, inset: 1 }), { x: 83, z: 54 });
  assert.deepEqual(pointOnWall(frame, "east", { along: 4, inset: 1 }), { x: 117, z: 54 });
});

await test("rotatedHalfExtents swaps on quarter turns", () => {
  const size = { x: 4, z: 2 };
  assert.deepEqual(rotatedHalfExtents(size, 0), { halfX: 2, halfZ: 1 });
  assert.deepEqual(rotatedHalfExtents(size, 90), { halfX: 1, halfZ: 2 });
  assert.deepEqual(rotatedHalfExtents(size, 180), { halfX: 2, halfZ: 1 });
  assert.deepEqual(rotatedHalfExtents(size, 270), { halfX: 1, halfZ: 2 });
});
