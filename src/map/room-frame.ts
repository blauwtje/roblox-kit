import { measureRoom } from "./map-spec.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";

export type Side = RoomSpec["doors"][number]["side"];

/** A rectangle on the floor plane in world coordinates. */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const sideOrder: Side[] = ["north", "south", "east", "west"];

/** Whether the wall on `side` runs along the X axis. */
export function runsAlongX(side: Side): boolean {
  return side === "north" || side === "south";
}

/** One room's center and the inner extents of its walls, in studs. */
export interface RoomFrame {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  wallThickness: number;
  wallHeight: number;
  doorWidth: number;
}

export function roomFrame(spec: MapSpec, room: RoomSpec): RoomFrame {
  const measure = measureRoom(spec, room);
  return {
    x: room.x,
    z: room.z,
    halfWidth: room.width / 2 - measure.wallThickness,
    halfDepth: room.depth / 2 - measure.wallThickness,
    ...measure,
  };
}

/** The box `depth` studs into the room from `side`'s inner face, between two positions along that wall. */
export function wallBox(
  frame: RoomFrame,
  side: Side,
  { alongMin, alongMax, depth }: { alongMin: number; alongMax: number; depth: number },
): Box {
  const { x, z, halfWidth, halfDepth } = frame;
  switch (side) {
    case "north":
      return {
        minX: x + alongMin,
        maxX: x + alongMax,
        minZ: z - halfDepth,
        maxZ: z - halfDepth + depth,
      };
    case "south":
      return {
        minX: x + alongMin,
        maxX: x + alongMax,
        minZ: z + halfDepth - depth,
        maxZ: z + halfDepth,
      };
    case "west":
      return {
        minX: x - halfWidth,
        maxX: x - halfWidth + depth,
        minZ: z + alongMin,
        maxZ: z + alongMax,
      };
    case "east":
      return {
        minX: x + halfWidth - depth,
        maxX: x + halfWidth,
        minZ: z + alongMin,
        maxZ: z + alongMax,
      };
  }
}

/** World center of a point `along` a wall from the room center and `inset` studs in from its inner face. */
export function pointOnWall(
  frame: RoomFrame,
  side: Side,
  { along, inset }: { along: number; inset: number },
): { x: number; z: number } {
  const { x, z, halfWidth, halfDepth } = frame;
  switch (side) {
    case "north":
      return { x: x + along, z: z - halfDepth + inset };
    case "south":
      return { x: x + along, z: z + halfDepth - inset };
    case "west":
      return { x: x - halfWidth + inset, z: z + along };
    case "east":
      return { x: x + halfWidth - inset, z: z + along };
  }
}

/** Half the X and Z extents of a box of `size` turned by `yaw` degrees; a quarter turn swaps them. */
export function rotatedHalfExtents(
  size: { x: number; z: number },
  yaw: number,
): { halfX: number; halfZ: number } {
  const turned = Math.abs(Math.round(yaw / 90)) % 2 === 1;
  return { halfX: (turned ? size.z : size.x) / 2, halfZ: (turned ? size.x : size.z) / 2 };
}
