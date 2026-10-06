import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSpecSchema } from "./map-spec.ts";
import { placeProps, propSize, roomBounds } from "./prop-placement.ts";
import type { PropRecord } from "./prop-placement.ts";

const spec = mapSpecSchema.parse({
  mapId: "orientation",
  rooms: [{ name: "room", x: 0, z: 0, width: 80, depth: 80 }],
});
const room = spec.rooms.find((candidate) => candidate.name === "room");
assert.ok(room);
const wallHeight = roomBounds(spec, room).wallHeight;

/** The yaw that turns a prop's -Z front toward the room from the wall it stands against. */
function expectedYaw(prop: PropRecord): number {
  const fromEast = prop.pivot.x;
  const fromSouth = prop.pivot.z;
  if (Math.abs(fromSouth) > Math.abs(fromEast)) {
    return fromSouth > 0 ? 0 : 180;
  }
  return fromEast > 0 ? 90 : 270;
}

await test("a kit prop keeps its own-frame size and faces the room from every wall", () => {
  const seen = new Set<number>();
  for (let seed = 0; seed < 10; seed += 1) {
    for (const prop of placeProps(spec, ["bench", "stairs", "rail"], seed)) {
      const own = propSize(prop.kind, wallHeight);
      assert.deepEqual(prop.size, own, `${prop.kind} at ${JSON.stringify(prop.pivot)}`);
      const { yaw } = prop;
      assert.equal(yaw, expectedYaw(prop), `${prop.kind} yaw at ${JSON.stringify(prop.pivot)}`);
      seen.add(expectedYaw(prop));
    }
  }
  assert.equal(seen.size, 4, "props landed against all four walls");
});
