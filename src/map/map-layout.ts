import { config } from "../config.ts";
import type { MapSpec, RoomSpec, TerrainFill } from "./map-spec.ts";

export interface Vector {
  x: number;
  y: number;
  z: number;
}

/** One axis-aligned part; `position` is its center, in studs. */
export interface PartRecord {
  /** Unique within the map. */
  name: string;
  /** The zone (room name) the part belongs to. */
  room: string;
  kind: "floor" | "wall" | "spawn";
  position: Vector;
  size: Vector;
  material: string;
}

export interface MapLayout {
  parts: PartRecord[];
  terrainFills: TerrainFill[];
}

type Side = RoomSpec["doors"][number]["side"];

interface RoomStyle {
  floorMaterial: string;
  wallMaterial: string;
  wallHeight: number;
  wallThickness: number;
  doorWidth: number;
}

/** A stretch of wall, measured along the wall from its center. */
interface Interval {
  start: number;
  end: number;
}

const sides: Side[] = ["north", "south", "east", "west"];

/** Room settings win over map settings, which win over the config defaults. */
function resolveStyle(spec: MapSpec, room: RoomSpec): RoomStyle {
  return {
    floorMaterial: room.floorMaterial ?? spec.floorMaterial ?? config.defaultFloorMaterial,
    wallMaterial: room.wallMaterial ?? spec.wallMaterial ?? config.defaultWallMaterial,
    wallHeight: room.wallHeight ?? spec.wallHeight ?? config.defaultWallHeightStuds,
    wallThickness: room.wallThickness ?? spec.wallThickness ?? config.defaultWallThicknessStuds,
    doorWidth: room.doorWidth ?? spec.doorWidth ?? config.defaultDoorWidthStuds,
  };
}

/** The door gaps of one side, sorted, each checked to lie inside the wall and clear of the others. */
function doorGaps(room: RoomSpec, side: Side, wallLength: number, doorWidth: number): Interval[] {
  const gaps = room.doors
    .filter((door) => door.side === side)
    .map((door) => ({ start: door.offset - doorWidth / 2, end: door.offset + doorWidth / 2 }))
    .sort((first, second) => first.start - second.start);
  let previousEnd = -wallLength / 2;
  for (const gap of gaps) {
    if (gap.start < previousEnd || gap.end > wallLength / 2) {
      throw new Error(
        `Room "${room.name}": the ${side} door at offset ${String(gap.start + doorWidth / 2)} does not fit in the wall (length ${String(wallLength)}) or overlaps another door. Move it, narrow doorWidth or enlarge the room.`,
      );
    }
    previousEnd = gap.end;
  }
  return gaps;
}

/** The wall stretches left between the door gaps. */
function wallStretches(wallLength: number, gaps: Interval[]): Interval[] {
  const stretches: Interval[] = [];
  let cursor = -wallLength / 2;
  for (const gap of gaps) {
    if (gap.start > cursor) {
      stretches.push({ start: cursor, end: gap.start });
    }
    cursor = gap.end;
  }
  if (wallLength / 2 > cursor) {
    stretches.push({ start: cursor, end: wallLength / 2 });
  }
  return stretches;
}

function wallParts(room: RoomSpec, style: RoomStyle): PartRecord[] {
  const parts: PartRecord[] = [];
  const thickness = style.wallThickness;
  for (const side of sides) {
    const runsAlongX = side === "north" || side === "south";
    // North and south walls span the full width; east and west walls fit between them.
    const wallLength = runsAlongX ? room.width : room.depth - 2 * thickness;
    const towardPositive = side === "south" || side === "east";
    const sign = towardPositive ? 1 : -1;
    const stretches = wallStretches(wallLength, doorGaps(room, side, wallLength, style.doorWidth));
    for (const [index, stretch] of stretches.entries()) {
      const length = stretch.end - stretch.start;
      const alongCenter = (stretch.start + stretch.end) / 2;
      const acrossOffset = sign * ((runsAlongX ? room.depth : room.width) / 2 - thickness / 2);
      parts.push({
        name: `${room.name}${config.wallNameInfix}${side}-${String(index + 1)}`,
        room: room.name,
        kind: "wall",
        position: {
          x: room.x + (runsAlongX ? alongCenter : acrossOffset),
          y: style.wallHeight / 2,
          z: room.z + (runsAlongX ? acrossOffset : alongCenter),
        },
        size: {
          x: runsAlongX ? length : thickness,
          y: style.wallHeight,
          z: runsAlongX ? thickness : length,
        },
        material: style.wallMaterial,
      });
    }
  }
  return parts;
}

function floorPart(room: RoomSpec, style: RoomStyle): PartRecord {
  return {
    name: `${room.name}${config.floorNameSuffix}`,
    room: room.name,
    kind: "floor",
    position: { x: room.x, y: -style.wallThickness / 2, z: room.z },
    size: { x: room.width, y: style.wallThickness, z: room.depth },
    material: style.floorMaterial,
  };
}

/** A pad as wide as a door, standing on the floor at the room center. */
function spawnPart(room: RoomSpec, style: RoomStyle): PartRecord {
  return {
    name: `${room.name}${config.spawnNameSuffix}`,
    room: room.name,
    kind: "spawn",
    position: { x: room.x, y: style.wallThickness / 2, z: room.z },
    size: { x: style.doorWidth, y: style.wallThickness, z: style.doorWidth },
    material: style.floorMaterial,
  };
}

function assertRoomFits(room: RoomSpec, style: RoomStyle): void {
  const smallestSpan = 2 * style.wallThickness;
  if (room.width <= smallestSpan || room.depth <= smallestSpan) {
    throw new Error(
      `Room "${room.name}" is ${String(room.width)} by ${String(room.depth)} studs, no larger than two wall thicknesses (${String(smallestSpan)}). Enlarge it or thin the walls.`,
    );
  }
}

/** Turns a map spec into parts and terrain fills; the same spec always yields the same layout. */
export function layoutMap(spec: MapSpec): MapLayout {
  const parts: PartRecord[] = [];
  for (const room of spec.rooms) {
    const style = resolveStyle(spec, room);
    assertRoomFits(room, style);
    parts.push(floorPart(room, style), ...wallParts(room, style));
    if (room.spawn) {
      parts.push(spawnPart(room, style));
    }
  }
  return { parts, terrainFills: spec.terrain };
}
