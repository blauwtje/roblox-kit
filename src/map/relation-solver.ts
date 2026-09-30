import { config } from "../config.ts";
import type { MapSpec, RelationMapSpec, RelationRoomSpec, RoomSpec } from "./map-spec.ts";

type Side = RoomSpec["doors"][number]["side"];
type RelatedRoom = Extract<RelationRoomSpec, { relation: object }>;
type Axis = "x" | "z";

interface Direction {
  /** The axis a room set in this direction moves along. */
  axis: Axis;
  sign: 1 | -1;
  opposite: Side;
}

const directions: Record<Side, Direction> = {
  north: { axis: "z", sign: -1, opposite: "south" },
  south: { axis: "z", sign: 1, opposite: "north" },
  east: { axis: "x", sign: 1, opposite: "west" },
  west: { axis: "x", sign: -1, opposite: "east" },
};

const extentOfAxis = { x: "width", z: "depth" } as const;
const otherAxis = { x: "z", z: "x" } as const;

interface Resolution {
  spec: RelationMapSpec;
  roomsByName: Map<string, RelationRoomSpec>;
  /** Rooms with a center, in the order they were resolved. */
  placed: Map<string, RoomSpec>;
  /** Names of the rooms the solver placed and of the hallways it added: the ones checked for collisions. */
  solverNames: Set<string>;
  hallways: RoomSpec[];
}

/** The grid multiple the given rounding picks; the added 0 turns -0 into 0, which strict equality tells apart. */
function snapToGrid(value: number, round: (quotient: number) => number): number {
  return round(value / config.gridStuds) * config.gridStuds + 0;
}

/** The door width a room's own settings give, the way map-layout resolves it. */
function doorWidthOf(room: RoomSpec, spec: RelationMapSpec): number {
  return room.doorWidth ?? spec.doorWidth ?? config.defaultDoorWidthStuds;
}

function addDoor(resolution: Resolution, roomName: string, side: Side, offset: number): void {
  const room = resolution.placed.get(roomName);
  if (!room) {
    throw new Error(`Room "${roomName}" has no center to hang a door on.`);
  }
  resolution.placed.set(roomName, { ...room, doors: [...room.doors, { side, offset }] });
}

/**
 * Places `room` beside `target`, snapped to the grid, and adds the hallway between them
 * with a door on each room and on both hallway ends.
 */
function placeRelated(resolution: Resolution, room: RelatedRoom, target: RoomSpec): void {
  const { spec } = resolution;
  const { relation, ...roomShape } = room;
  const { axis, sign, opposite } = directions[relation.direction];
  const perpendicular = otherAxis[axis];
  const extent = extentOfAxis[axis];

  const targetEdge = target[axis] + (sign * target[extent]) / 2;
  const unsnappedCenter = targetEdge + sign * (relation.hallwayLength + room[extent] / 2);
  // Snapping away from the target keeps the hallway at least as long as asked.
  const center = snapToGrid(unsnappedCenter, sign > 0 ? Math.ceil : Math.floor);
  const perpendicularCenter = snapToGrid(target[perpendicular], Math.round);
  const nearEdge = center - (sign * room[extent]) / 2;
  const hallwayLength = sign * (nearEdge - targetEdge);

  const placedRoom: RoomSpec = {
    ...roomShape,
    [axis]: center,
    [perpendicular]: perpendicularCenter,
  } as RoomSpec;
  resolution.placed.set(room.name, placedRoom);
  resolution.solverNames.add(room.name);

  const hallwayName = `${target.name}-${room.name}-hallway`;
  if (resolution.roomsByName.has(hallwayName) || resolution.solverNames.has(hallwayName)) {
    throw new Error(
      `The hallway between "${target.name}" and "${room.name}" would be named "${hallwayName}", which another room already uses. Rename that room.`,
    );
  }
  const thickness = spec.wallThickness ?? config.defaultWallThicknessStuds;
  const hallwayDoorWidth = Math.min(
    doorWidthOf(target, spec),
    doorWidthOf(placedRoom, spec),
    relation.hallwayWidth - 2 * thickness,
  );
  if (hallwayDoorWidth <= 0) {
    throw new Error(
      `The hallway between "${target.name}" and "${room.name}" is ${String(relation.hallwayWidth)} wide, too narrow for a door between walls ${String(thickness)} thick. Widen the hallway.`,
    );
  }
  const alongSize = { [extent]: hallwayLength };
  const acrossSize = { [extentOfAxis[perpendicular]]: relation.hallwayWidth };
  const hallway = {
    name: hallwayName,
    ...alongSize,
    ...acrossSize,
    [axis]: (targetEdge + nearEdge) / 2,
    [perpendicular]: target[perpendicular],
    doors: [
      { side: opposite, offset: 0 },
      { side: relation.direction, offset: 0 },
    ],
    spawn: false,
    doorWidth: hallwayDoorWidth,
  } as RoomSpec;
  resolution.hallways.push(hallway);
  resolution.solverNames.add(hallwayName);

  addDoor(resolution, target.name, relation.direction, 0);
  addDoor(resolution, room.name, opposite, target[perpendicular] - perpendicularCenter);
}

/** Resolves `room` after the room it relates to; `chain` holds the rooms being resolved above it. */
function resolveRoom(resolution: Resolution, room: RelationRoomSpec, chain: string[]): void {
  if (resolution.placed.has(room.name)) {
    return;
  }
  if (chain.includes(room.name)) {
    const cycle = [...chain.slice(chain.indexOf(room.name)), room.name];
    throw new Error(`Rooms depend on each other through relations: ${cycle.join(" -> ")}.`);
  }
  if (!("relation" in room)) {
    resolution.placed.set(room.name, room);
    return;
  }
  const targetName = room.relation.to;
  const target = resolution.roomsByName.get(targetName);
  if (!target) {
    throw new Error(`Room "${room.name}" is placed relative to unknown room "${targetName}".`);
  }
  resolveRoom(resolution, target, [...chain, room.name]);
  const placedTarget = resolution.placed.get(targetName);
  if (!placedTarget) {
    throw new Error(`Room "${targetName}" was not placed before "${room.name}".`);
  }
  placeRelated(resolution, room, placedTarget);
}

function overlapDepth(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  return Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart);
}

/** Rooms that share more than face contact; only pairs with a solver-made room are checked, so placed-only specs build as before. */
function assertNoCollisions(resolution: Resolution, rooms: RoomSpec[]): void {
  for (const [index, first] of rooms.entries()) {
    for (const second of rooms.slice(index + 1)) {
      if (!resolution.solverNames.has(first.name) && !resolution.solverNames.has(second.name)) {
        continue;
      }
      const overlapX = overlapDepth(
        first.x - first.width / 2,
        first.x + first.width / 2,
        second.x - second.width / 2,
        second.x + second.width / 2,
      );
      const overlapZ = overlapDepth(
        first.z - first.depth / 2,
        first.z + first.depth / 2,
        second.z - second.depth / 2,
        second.z + second.depth / 2,
      );
      if (overlapX > config.overlapToleranceStuds && overlapZ > config.overlapToleranceStuds) {
        throw new Error(
          `Rooms "${first.name}" and "${second.name}" overlap; move one, change a hallway length or shrink a room.`,
        );
      }
    }
  }
}

/**
 * Turns a spec whose rooms may be placed by relation into one whose rooms all have a center.
 * Rooms come in dependency order (a room after the one it relates to, otherwise in spec order),
 * the hallway rooms are appended, and each hallway's two rooms gain a matching door.
 */
export function resolveRelations(spec: RelationMapSpec): MapSpec {
  const resolution: Resolution = {
    spec,
    roomsByName: new Map(spec.rooms.map((room) => [room.name, room])),
    placed: new Map(),
    solverNames: new Set(),
    hallways: [],
  };
  for (const room of spec.rooms) {
    resolveRoom(resolution, room, []);
  }
  const rooms = [...resolution.placed.values(), ...resolution.hallways];
  assertNoCollisions(resolution, rooms);
  return { ...spec, rooms };
}
