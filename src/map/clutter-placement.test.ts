import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSpecSchema } from "./map-spec.ts";
import { clutterDimensions, placeClutter } from "./clutter-placement.ts";
import { doorwayFootprint, overlaps, roomBounds } from "./prop-placement.ts";
import type { Footprint, PropRecord } from "./prop-placement.ts";
import { rotatedHalfExtents } from "./room-frame.ts";

const spec = mapSpecSchema.parse({
  mapId: "clutter",
  rooms: [
    {
      name: "hall",
      x: 10,
      z: -20,
      width: 60,
      depth: 40,
      roomType: "hall",
      doors: [{ side: "north", offset: 5 }],
    },
    { name: "plain", x: 100, z: 0, width: 40, depth: 40 },
  ],
});
const roomTypes = {
  hall: {
    clutter: [
      { kind: "bin", density: 0.5 },
      { kind: "poster", density: 0.2 },
    ],
  },
};
const hall = spec.rooms.find((room) => room.name === "hall") ?? assert.fail("hall");
const bench: PropRecord = {
  kind: "bench",
  pivot: { x: 10, y: 1, z: -20 },
  size: { x: 6, y: 2, z: 2.5 },
  yaw: 0,
  seed: 1,
};

function box(prop: PropRecord): Footprint {
  const { halfX, halfZ } = rotatedHalfExtents(prop.size, prop.yaw ?? 0);
  return {
    minX: prop.pivot.x - hall.x - halfX,
    maxX: prop.pivot.x - hall.x + halfX,
    minZ: prop.pivot.z - hall.z - halfZ,
    maxZ: prop.pivot.z - hall.z + halfZ,
  };
}

await test("clutter is deterministic and only fills rooms whose type lists it", () => {
  const first = placeClutter(spec, roomTypes, { seed: 3 });
  assert.ok(first.length > 0);
  assert.deepEqual(first, placeClutter(spec, roomTypes, { seed: 3 }));
  assert.ok(first.every((prop) => Math.abs(prop.pivot.x - hall.x) < 30));
});

await test("clutter avoids placed props, doorways and the walkway, and keeps spacing", () => {
  const items = placeClutter(spec, roomTypes, { seed: 5, placed: [bench], density: 2 });
  assert.ok(items.length > 2);
  const bounds = roomBounds(spec, hall);
  const doorway = doorwayFootprint(bounds, hall.doors[0] ?? assert.fail("door"));
  const walkway: Footprint = { minX: -2, maxX: 7, minZ: -bounds.halfDepth, maxZ: 0 };
  const boxes = items.map(box);
  for (const [index, item] of boxes.entries()) {
    assert.equal(overlaps(item, box(bench)), false);
    assert.equal(overlaps(item, doorway), false);
    assert.equal(overlaps(item, walkway), false);
    for (const other of boxes.slice(index + 1)) {
      const gap = clutterDimensions.minSpacingStuds;
      const grown = (b: Footprint): Footprint => ({
        minX: b.minX - gap / 2 + 0.001,
        maxX: b.maxX + gap / 2 - 0.001,
        minZ: b.minZ - gap / 2 + 0.001,
        maxZ: b.maxZ + gap / 2 - 0.001,
      });
      assert.equal(overlaps(grown(item), grown(other)), false);
    }
  }
});

await test("clutter count scales with density", () => {
  const few = placeClutter(spec, roomTypes, { seed: 9, density: 0.5 }).length;
  const many = placeClutter(spec, roomTypes, { seed: 9, density: 2 }).length;
  assert.ok(many > few, `${String(many)} should exceed ${String(few)}`);
});

await test("an unknown clutter kind throws", () => {
  assert.throws(
    () => placeClutter(spec, { hall: { clutter: [{ kind: "ghost", density: 1 }] } }, { seed: 1 }),
    /ghost/,
  );
});
