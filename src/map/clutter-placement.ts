import { config } from "../config.ts";
import { createSeededRandom } from "../shared/seeded-random.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
import {
  cornerFootprints,
  doorwayFootprint,
  isPropKind,
  overlaps,
  propDimensions,
  propKinds,
  propSize,
  roomBounds,
  yawFacing,
} from "./prop-placement.ts";
import type { Footprint, PropKind, PropRecord, RoomBounds } from "./prop-placement.ts";
import { pointOnWall, rotatedHalfExtents, sideOrder } from "./room-frame.ts";

export const clutterDimensions = Object.freeze({
  minSpacingStuds: 2,
  propClearanceStuds: 1,
  posterInsetStuds: 0.1,
  attemptsPerItem: 12,
  roomSeedStride: 6007,
  densityAreaSquareStuds: 100,
});

export type ClutterTypes = Record<string, { clutter?: { kind: string; density: number }[] }>;

export interface ClutterRun {
  seed: number;
  placed?: PropRecord[];
  density?: number;
}

function footprintOf(prop: PropRecord, room: RoomSpec, margin: number): Footprint {
  const { halfX, halfZ } = rotatedHalfExtents(prop.size, prop.yaw ?? 0);
  const x = prop.pivot.x - room.x;
  const z = prop.pivot.z - room.z;
  return {
    minX: x - halfX - margin,
    maxX: x + halfX + margin,
    minZ: z - halfZ - margin,
    maxZ: z + halfZ + margin,
  };
}

function walkwayFootprints(bounds: RoomBounds, room: RoomSpec): Footprint[] {
  const frame = { x: 0, z: 0, wallThickness: 0, ...bounds };
  const half = bounds.doorWidth / 2 + propDimensions.clearanceStuds;
  return room.doors.map((door) => {
    const end = pointOnWall(frame, door.side, { along: door.offset, inset: 0 });
    return {
      minX: Math.min(end.x, 0) - half,
      maxX: Math.max(end.x, 0) + half,
      minZ: Math.min(end.z, 0) - half,
      maxZ: Math.max(end.z, 0) + half,
    };
  });
}

interface Slot {
  footprint: Footprint;
  y: number;
  yaw: number;
}

interface Spot {
  kind: PropKind;
  size: { x: number; z: number };
  bounds: RoomBounds;
  random: () => number;
}

function candidate({ kind, size, bounds, random }: Spot): Slot {
  if (kind === "poster") {
    const side = sideOrder[Math.floor(random() * sideOrder.length)] ?? "north";
    const wallHalf = side === "north" || side === "south" ? bounds.halfWidth : bounds.halfDepth;
    const reach = Math.max(0, wallHalf - size.x / 2);
    const yaw = yawFacing[side];
    const { halfX, halfZ } = rotatedHalfExtents(size, yaw);
    const frame = { x: 0, z: 0, wallThickness: 0, ...bounds };
    const along = (random() * 2 - 1) * reach;
    const center = pointOnWall(frame, side, {
      along,
      inset: clutterDimensions.posterInsetStuds + size.z / 2,
    });
    const footprint = {
      minX: center.x - halfX,
      maxX: center.x + halfX,
      minZ: center.z - halfZ,
      maxZ: center.z + halfZ,
    };
    return { footprint, y: config.character.eyeHeightStuds, yaw };
  }
  const yaw = Math.floor(random() * 4) * 90;
  const { halfX, halfZ } = rotatedHalfExtents(size, yaw);
  const spanX = Math.max(0, bounds.halfWidth - halfX - propDimensions.clearanceStuds);
  const spanZ = Math.max(0, bounds.halfDepth - halfZ - propDimensions.clearanceStuds);
  const x = (random() * 2 - 1) * spanX;
  const z = (random() * 2 - 1) * spanZ;
  return {
    footprint: { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ },
    y: 0,
    yaw,
  };
}

function grow(footprint: Footprint, margin: number): Footprint {
  return {
    minX: footprint.minX - margin,
    maxX: footprint.maxX + margin,
    minZ: footprint.minZ - margin,
    maxZ: footprint.maxZ + margin,
  };
}

interface RoomRun {
  spec: MapSpec;
  room: RoomSpec;
  placed: PropRecord[];
  multiplier: number;
  random: () => number;
}

function isFree(slot: Slot, fixed: Footprint[], taken: Footprint[]): boolean {
  const half = clutterDimensions.minSpacingStuds / 2;
  const spaced = grow(slot.footprint, half);
  return (
    !fixed.some((other) => overlaps(slot.footprint, other)) &&
    !taken.some((other) => overlaps(spaced, grow(other, half)))
  );
}

function findSlot(spot: Spot, fixed: Footprint[], taken: Footprint[]): Slot | undefined {
  for (let attempt = 0; attempt < clutterDimensions.attemptsPerItem; attempt += 1) {
    const slot = candidate(spot);
    if (isFree(slot, fixed, taken)) {
      return slot;
    }
  }
  return undefined;
}

function recordAt(room: RoomSpec, spot: Spot, slot: Slot & { seed: number }): PropRecord {
  const size = propSize(spot.kind, spot.bounds.wallHeight);
  const y = slot.y === 0 ? size.y / 2 : Math.min(slot.y, spot.bounds.wallHeight - size.y / 2);
  return {
    kind: spot.kind,
    pivot: {
      x: room.x + (slot.footprint.minX + slot.footprint.maxX) / 2,
      y,
      z: room.z + (slot.footprint.minZ + slot.footprint.maxZ) / 2,
    },
    size,
    yaw: slot.yaw,
    seed: slot.seed,
  };
}

function roomClutter(run: RoomRun, densities: { kind: PropKind; density: number }[]): PropRecord[] {
  const { spec, room, placed, multiplier, random } = run;
  const bounds = roomBounds(spec, room);
  const area = 4 * bounds.halfWidth * bounds.halfDepth;
  const fixed = [
    ...cornerFootprints(bounds),
    ...room.doors.map((door) => doorwayFootprint(bounds, door)),
    ...walkwayFootprints(bounds, room),
    ...placed.map((prop) => footprintOf(prop, room, clutterDimensions.propClearanceStuds)),
  ];
  const taken: Footprint[] = [];
  const records: PropRecord[] = [];
  const wanted = densities.flatMap(({ kind, density }) => {
    const expected = (density * multiplier * area) / clutterDimensions.densityAreaSquareStuds;
    return Array.from({ length: Math.floor(expected + random()) }, () => kind);
  });
  for (const kind of wanted) {
    const seed = Math.floor(random() * 2 ** 31);
    const spot = { kind, size: propSize(kind, bounds.wallHeight), bounds, random };
    const slot = findSlot(spot, fixed, taken);
    if (slot !== undefined) {
      taken.push(slot.footprint);
      records.push(recordAt(room, spot, { ...slot, seed }));
    }
  }
  return records;
}

/**
 * Small clutter for every room whose type lists clutter densities, clear of `placed` props, corner pillars,
 * doorways, the walkways from doors to the room center and each other. Deterministic per seed.
 * Throws on a clutter kind with no generator.
 */
export function placeClutter(
  spec: MapSpec,
  roomTypes: ClutterTypes,
  run: ClutterRun,
): PropRecord[] {
  return spec.rooms.flatMap((room, roomIndex) => {
    const entries =
      (room.roomType === undefined ? undefined : roomTypes[room.roomType]?.clutter) ?? [];
    const densities = entries.map(({ kind, density }) => {
      if (!isPropKind(kind)) {
        throw new Error(
          `Clutter kind "${kind}" has no generator; use one of ${propKinds.join(", ")}.`,
        );
      }
      return { kind, density };
    });
    if (densities.length === 0) {
      return [];
    }
    const random = createSeededRandom(run.seed + roomIndex * clutterDimensions.roomSeedStride);
    return roomClutter(
      { spec, room, placed: run.placed ?? [], multiplier: run.density ?? 1, random },
      densities,
    );
  });
}
