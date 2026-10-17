export interface SchedulePoint {
  x: number;
  z: number;
}

export interface WalkerSchedule {
  route: readonly SchedulePoint[];
  studsPerSecond: number;
  dwellSeconds: number;
  phase: number;
}

export interface WalkerPose {
  x: number;
  z: number;
  yaw: number;
}

function yawToward(from: SchedulePoint, to: SchedulePoint): number | undefined {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return undefined;
  return (Math.atan2(-dx, -dz) * 180) / Math.PI + 0;
}

export function walkerPose(schedule: WalkerSchedule, seconds: number): WalkerPose {
  const { route, studsPerSecond: speed, dwellSeconds, phase } = schedule;
  const first = route[0];
  if (first === undefined) throw new Error("walker route needs at least one point");
  const lengths = route.slice(1).map((point, i) => {
    const from = route[i] as SchedulePoint;
    return Math.hypot(point.x - from.x, point.z - from.z);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0 || speed <= 0) return { x: first.x, z: first.z, yaw: 0 };

  const walkSeconds = total / speed;
  const half = walkSeconds + dwellSeconds;
  const cycle = 2 * half;
  const local = (((seconds + phase * cycle) % cycle) + cycle) % cycle;
  const forward = local < half;
  const leg = forward ? local : local - half;
  const distance = Math.min(leg * speed, total);

  const along = forward ? distance : total - distance;
  let rest = along;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i] as number;
    if (rest <= length || i === lengths.length - 1) {
      const from = route[i] as SchedulePoint;
      const to = route[i + 1] as SchedulePoint;
      const t = length === 0 ? 0 : Math.min(rest / length, 1);
      const heading = forward ? yawToward(from, to) : yawToward(to, from);
      return {
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
        yaw: heading ?? 0,
      };
    }
    rest -= length;
  }
  return { x: first.x, z: first.z, yaw: 0 };
}
