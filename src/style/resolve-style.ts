import { config } from "../config.ts";
import { extentOf, otherAxisOf, sideSteps, type MapSpec, type RoomSpec } from "../map/map-spec.ts";
import { presetOverridesSchema, presetSchema, type Preset } from "./preset-schema.ts";

/** What a map spec's `style` carries: a preset name and optional overrides of any subset of it. */
export interface StyleSelection {
  preset: string;
  overrides?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge: nested objects merge key by key; arrays and scalars in `overrides` replace the base value. */
function mergeDeep(base: unknown, overrides: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    return overrides;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(overrides)) {
    merged[key] = key in base ? mergeDeep(base[key], overrideValue) : overrideValue;
  }
  return merged;
}

/**
 * The preset named by `selection` with its overrides deep-merged in, validated by the full preset
 * schema so an override cannot leave the style out of range. Throws naming the preset, or the
 * invalid override path, and never returns a partial style.
 */
export function resolveStyle(
  presets: ReadonlyMap<string, Preset>,
  selection: StyleSelection,
): Preset {
  const base = presets.get(selection.preset);
  if (base === undefined) {
    const known = [...presets.keys()].join(", ");
    throw new Error(`Unknown style preset "${selection.preset}"; known presets: ${known}`);
  }
  if (selection.overrides === undefined) {
    return base;
  }
  const overrides = presetOverridesSchema.safeParse(selection.overrides);
  if (!overrides.success) {
    throw new Error(`Invalid style overrides: ${overrides.error.message}`, {
      cause: overrides.error,
    });
  }
  const resolved = presetSchema.safeParse(mergeDeep(base, overrides.data));
  if (!resolved.success) {
    throw new Error(
      `Style overrides leave preset "${selection.preset}" invalid: ${resolved.error.message}`,
      {
        cause: resolved.error,
      },
    );
  }
  return resolved.data;
}

/** How far the deepest room departs from the spawn room, as the factor at progression 1 (the spawn room is always 1). */
export const progressionScale = Object.freeze({
  /** Light range of the deepest room as a fraction of its role's range: deeper rooms read dimmer. */
  lightRange: 0.6,
  /** Accent stripe height of the deepest room as a multiple of the base height: deeper rooms use more accent. */
  accentStripeHeight: 2,
});

/** Interpolates from 1 at progression 0 to `atDeepest` at progression 1. */
export function progressionFactor(progression: number, atDeepest: number): number {
  return 1 + (atDeepest - 1) * progression;
}

/** Whether a door of `a` and a door of `b` meet: the rooms stand face to face and the doors line up. */
function roomsJoined(a: RoomSpec, b: RoomSpec): boolean {
  return a.doors.some((door) => {
    const { axis, sign, opposite } = sideSteps[door.side];
    const across = otherAxisOf[axis];
    const wallA = a[axis] + (sign * a[extentOf[axis]]) / 2;
    const wallB = b[axis] - (sign * b[extentOf[axis]]) / 2;
    if (Math.abs(wallA - wallB) > config.overlapToleranceStuds) {
      return false;
    }
    return b.doors.some(
      (other) =>
        other.side === opposite &&
        Math.abs(a[across] + door.offset - (b[across] + other.offset)) <=
          config.overlapToleranceStuds,
    );
  });
}

/**
 * How deep each room lies, 0 at a spawn room to 1 at the room farthest from it by doors: the graph
 * distance through joined doors, divided by the largest distance. A map with no spawn room, or no
 * room beyond it, and a room no door path reaches, stay at 0, so the map keeps its uniform look.
 */
export function roomProgression(spec: MapSpec): Map<string, number> {
  const distances = new Map<string, number>();
  let frontier = spec.rooms.filter((room) => room.spawn);
  for (const room of frontier) {
    distances.set(room.name, 0);
  }
  for (let distance = 1; frontier.length > 0; distance += 1) {
    const next: RoomSpec[] = [];
    for (const room of frontier) {
      for (const other of spec.rooms) {
        if (!distances.has(other.name) && roomsJoined(room, other)) {
          distances.set(other.name, distance);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  const deepest = Math.max(0, ...distances.values());
  return new Map(
    spec.rooms.map((room) => [
      room.name,
      deepest === 0 ? 0 : (distances.get(room.name) ?? 0) / deepest,
    ]),
  );
}
