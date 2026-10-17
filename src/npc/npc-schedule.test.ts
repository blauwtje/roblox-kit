import assert from "node:assert/strict";
import { test } from "node:test";
import { walkerPose } from "./npc-schedule.ts";
import type { WalkerSchedule } from "./npc-schedule.ts";

const schedule: WalkerSchedule = {
  route: [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
  ],
  studsPerSecond: 2,
  dwellSeconds: 4,
  phase: 0,
};

await test("walks along the route and turns at corners", () => {
  assert.deepEqual(walkerPose(schedule, 2), { x: 4, z: 0, yaw: -90 });
  const turned = walkerPose(schedule, 7);
  assert.deepEqual([turned.x, turned.z, Math.abs(turned.yaw)], [10, 4, 180]);
});

await test("dwells at each end, walks back and repeats", () => {
  const end = walkerPose(schedule, 12);
  assert.deepEqual([end.x, end.z], [10, 10]);
  assert.deepEqual(walkerPose(schedule, 13), { x: 10, z: 10, yaw: end.yaw });
  const back = walkerPose(schedule, 18);
  assert.deepEqual([back.x, back.z, back.yaw], [10, 2, 0]);
  assert.deepEqual(walkerPose(schedule, 28 + 2), walkerPose(schedule, 2));
});

await test("phase shifts the cycle and negative time wraps", () => {
  assert.deepEqual(walkerPose({ ...schedule, phase: 0.25 }, 0), walkerPose(schedule, 7));
  assert.deepEqual(walkerPose(schedule, -26), walkerPose(schedule, 2));
});

await test("a single point or zero speed stands still", () => {
  const still = { ...schedule, route: [{ x: 3, z: 4 }] };
  assert.deepEqual(walkerPose(still, 9), { x: 3, z: 4, yaw: 0 });
  assert.deepEqual(walkerPose({ ...schedule, studsPerSecond: 0 }, 9), { x: 0, z: 0, yaw: 0 });
});
