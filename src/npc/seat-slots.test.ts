import assert from "node:assert/strict";
import { test } from "node:test";
import type { PropRecord } from "../map/prop-placement.ts";
import { npcConfig } from "./npc-config.ts";
import { planSeatSlots } from "./seat-slots.ts";

const bench: PropRecord = {
  kind: "bench",
  pivot: { x: 10, y: 1.5, z: 20 },
  size: { x: 6, y: 3, z: 2.5 },
  seed: 7,
};

await test("a bench along X gets evenly spaced seats at seat height, owned by its seed", () => {
  const slots = planSeatSlots([bench]);
  assert.deepEqual(
    slots.map((slot) => slot.position),
    [8, 10, 12].map((x) => ({ x, y: 1.8, z: 20 })),
  );
  assert.ok(slots.every((slot) => slot.propSeed === 7 && slot.yaw === 0));
});

await test("a bench turned 90 degrees spreads its seats along Z and keeps its yaw", () => {
  const slots = planSeatSlots([{ ...bench, yaw: 90 }]);
  assert.deepEqual(
    slots.map((slot) => [slot.position.x, slot.position.z]),
    [
      [10, 22],
      [10, 20],
      [10, 18],
    ],
  );
  assert.equal(slots[0]?.yaw, 90);
});

await test("other kinds give no seats and a narrow bench still gets one", () => {
  const narrow = { ...bench, size: { x: npcConfig.seatSpacingStuds - 1, y: 3, z: 2 } };
  assert.equal(planSeatSlots([{ ...bench, kind: "lamp" }]).length, 0);
  assert.equal(planSeatSlots([narrow]).length, 1);
});
