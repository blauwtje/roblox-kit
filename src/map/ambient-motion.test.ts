import assert from "node:assert/strict";
import { test } from "node:test";
import { motionAttributes, motionAttributesByKind } from "./ambient-motion.ts";
import type { IdleAnimation } from "../style/preset-schema.ts";

const base = { swayDegrees: 6, periodSeconds: 1, hinge: "top" } as const;

await test("each kind maps its swayDegrees to the amplitude its motion reads", () => {
  assert.deepEqual(motionAttributes({ ...base, kind: "tick" }), {
    MotionKind: "tick",
    MotionPeriodSeconds: 1,
    MotionAmplitude: 6,
  });
  assert.equal(motionAttributes({ ...base, kind: "sway" }).MotionAmplitude, 6);
  assert.equal(
    motionAttributes({ ...base, kind: "flicker", swayDegrees: 22.5 }).MotionAmplitude,
    0.5,
  );
  assert.equal(motionAttributes({ ...base, kind: "flicker", swayDegrees: 45 }).MotionAmplitude, 1);
});

await test("a flip changes at least one row pair", () => {
  assert.equal(motionAttributes({ ...base, kind: "flip", swayDegrees: 0.2 }).MotionAmplitude, 1);
  assert.equal(motionAttributes({ ...base, kind: "flip", swayDegrees: 2 }).MotionAmplitude, 2);
});

await test("attributes are keyed by prop kind", () => {
  const idle: Record<string, IdleAnimation> = {
    clock: { ...base, kind: "tick" },
    lamp: { ...base, kind: "flicker" },
    "departure-board": { ...base, kind: "flip" },
  };
  const byKind = motionAttributesByKind(idle);
  assert.deepEqual(Object.keys(byKind), ["clock", "lamp", "departure-board"]);
  assert.equal(byKind["lamp"]?.MotionKind, "flicker");
});
