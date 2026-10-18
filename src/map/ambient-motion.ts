import type { IdleAnimation } from "../style/preset-schema.ts";

/**
 * The attributes `idle-animation.luau` reads off a prop Model. `MotionAmplitude` is degrees for `sway` and `tick`,
 * the share of brightness lost (0 to 1) for `flicker` and the number of row pairs swapped per period for `flip`.
 */
export type MotionAttributes = {
  MotionKind: IdleAnimation["kind"];
  MotionPeriodSeconds: number;
  MotionAmplitude: number;
};

const maxSwayDegreesInSchema = 45;

function amplitudeFor(idle: IdleAnimation): number {
  switch (idle.kind) {
    case "flicker":
      return Math.min(1, idle.swayDegrees / maxSwayDegreesInSchema);
    case "flip":
      return Math.max(1, Math.round(idle.swayDegrees));
    default:
      return idle.swayDegrees;
  }
}

/** The motion attributes of one prop kind's idle animation. */
export function motionAttributes(idle: IdleAnimation): MotionAttributes {
  return {
    MotionKind: idle.kind,
    MotionPeriodSeconds: idle.periodSeconds,
    MotionAmplitude: amplitudeFor(idle),
  };
}

/** The motion attributes of every animated prop kind, keyed by prop kind. */
export function motionAttributesByKind(
  idleAnimations: Record<string, IdleAnimation>,
): Record<string, MotionAttributes> {
  return Object.fromEntries(
    Object.entries(idleAnimations).map(([kind, idle]) => [kind, motionAttributes(idle)]),
  );
}
