import { config } from "../config.ts";
import { createSeededRandom } from "../shared/seeded-random.ts";
import {
  extentOf,
  otherAxisOf,
  sideSteps,
  type MapSpec,
  type RelationMapSpec,
  type RelationRoomSpec,
  type RoomSpec,
} from "./map-spec.ts";

type RelatedRoom = Extract<RelationRoomSpec, { relation: object }>;

/** One related room with what its hallway needs that does not depend on where the room ends up. */
interface Link {
  room: RelatedRoom;
  hallwayName: string;
  hallwayDoorWidth: number;
}

/** A candidate pose: grid steps of extra hallway length and of sideways shift away from the target's line. */
interface Pose {
  extraSteps: number;
  lateralSteps: number;
}

/** A related room at one pose, its hallway and the doors it adds to the target and to itself. */
interface Placement {
  room: RoomSpec;
  hallway: RoomSpec;
  targetDoor: Door;
  roomDoor: Door;
}

interface Resolution {
  spec: RelationMapSpec;
  roomsByName: Map<string, RelationRoomSpec>;
  /** Rooms with a center. */
  placed: Map<string, RoomSpec>;
  /** Room names in the order they were resolved. */
  order: string[];
  /** Related rooms in dependency order: each after the room it relates to. */
  links: Link[];
}

type Door = RoomSpec["doors"][number];

/** The grid multiple the given rounding picks; the added 0 turns -0 into 0, which strict equality tells apart. */
function snapToGrid(value: number, round: (quotient: number) => number): number {
  return round(value / config.gridStuds) * config.gridStuds + 0;
}

/** The door width a room's own settings give, the way map-layout resolves it. */
function doorWidthOf(room: { doorWidth?: number }, spec: RelationMapSpec): number {
  return room.doorWidth ?? spec.doorWidth ?? config.defaultDoorWidthStuds;
}

function addDoor(placed: Map<string, RoomSpec>, roomName: string, door: Door): void {
  const room = placed.get(roomName);
  if (!room) {
    throw new Error(`Room "${roomName}" has no center to hang a door on.`);
  }
  placed.set(roomName, { ...room, doors: [...room.doors, door] });
}

/** Checks what a related room's hallway needs whatever the room's pose: a free name and a door that fits. */
function linkOf(resolution: Resolution, room: RelatedRoom, taken: Set<string>): Link {
  const { spec, roomsByName } = resolution;
  const { relation } = room;
  const target = roomsByName.get(relation.to) as RelationRoomSpec;
  const hallwayName = `${target.name}-${room.name}-hallway`;
  if (roomsByName.has(hallwayName) || taken.has(hallwayName)) {
    throw new Error(
      `The hallway between "${target.name}" and "${room.name}" would be named "${hallwayName}", which another room already uses. Rename that room.`,
    );
  }
  taken.add(hallwayName);
  const thickness = spec.wallThickness ?? config.defaultWallThicknessStuds;
  const hallwayDoorWidth = Math.min(
    doorWidthOf(target, spec),
    doorWidthOf(room, spec),
    relation.hallwayWidth - 2 * thickness,
  );
  if (hallwayDoorWidth <= 0) {
    throw new Error(
      `The hallway between "${target.name}" and "${room.name}" is ${String(relation.hallwayWidth)} wide, too narrow for a door between walls ${String(thickness)} thick. Widen the hallway.`,
    );
  }
  return { room, hallwayName, hallwayDoorWidth };
}

/**
 * Places `link.room` beside `target` at `pose`, snapped to the grid, with the hallway between them
 * and a door on each room and on both hallway ends. Undefined when a sideways shift would leave the
 * hallway's door outside the room's wall.
 */
function placeRelated(
  spec: RelationMapSpec,
  link: Link,
  target: RoomSpec,
  pose: Pose,
): Placement | undefined {
  const { room, hallwayName, hallwayDoorWidth } = link;
  const { relation, ...roomShape } = room;
  const { axis, sign, opposite } = sideSteps[relation.direction];
  const perpendicular = otherAxisOf[axis];
  const extent = extentOf[axis];

  const targetEdge = target[axis] + (sign * target[extent]) / 2;
  const unsnappedCenter = targetEdge + sign * (relation.hallwayLength + room[extent] / 2);
  // Snapping away from the target keeps the hallway at least as long as asked.
  const snapped = snapToGrid(unsnappedCenter, sign > 0 ? Math.ceil : Math.floor);
  const center = snapped + sign * pose.extraSteps * config.gridStuds;
  const perpendicularCenter =
    snapToGrid(target[perpendicular], Math.round) + pose.lateralSteps * config.gridStuds;
  const doorOffset = target[perpendicular] - perpendicularCenter;
  const thickness = spec.wallThickness ?? config.defaultWallThicknessStuds;
  const reach = room[extentOf[perpendicular]] / 2 - thickness - hallwayDoorWidth / 2;
  if (pose.lateralSteps !== 0 && Math.abs(doorOffset) > reach) {
    return undefined;
  }
  const nearEdge = center - (sign * room[extent]) / 2;
  const hallwayLength = sign * (nearEdge - targetEdge);

  const placedRoom = {
    ...roomShape,
    [axis]: center,
    [perpendicular]: perpendicularCenter,
  } as RoomSpec;
  const alongSize = { [extent]: hallwayLength };
  const acrossSize = { [extentOf[perpendicular]]: relation.hallwayWidth };
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
  return {
    room: placedRoom,
    hallway,
    targetDoor: { side: relation.direction, offset: 0 },
    roomDoor: { side: opposite, offset: doorOffset },
  };
}

/** Orders `room` after the room it relates to; `chain` holds the rooms being ordered above it. */
function orderRoom(
  resolution: Resolution,
  room: RelationRoomSpec,
  chain: string[],
  ordered: Set<string>,
  taken: Set<string>,
): void {
  if (ordered.has(room.name)) {
    return;
  }
  if (chain.includes(room.name)) {
    const cycle = [...chain.slice(chain.indexOf(room.name)), room.name];
    throw new Error(`Rooms depend on each other through relations: ${cycle.join(" -> ")}.`);
  }
  if (!("relation" in room)) {
    resolution.placed.set(room.name, room);
    ordered.add(room.name);
    resolution.order.push(room.name);
    return;
  }
  const targetName = room.relation.to;
  const target = resolution.roomsByName.get(targetName);
  if (!target) {
    throw new Error(`Room "${room.name}" is placed relative to unknown room "${targetName}".`);
  }
  orderRoom(resolution, target, [...chain, room.name], ordered, taken);
  resolution.links.push(linkOf(resolution, room, taken));
  ordered.add(room.name);
  resolution.order.push(room.name);
}

function overlapDepth(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  return Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart);
}

/** Whether two rooms share more than face contact. */
function roomsOverlap(first: RoomSpec, second: RoomSpec): boolean {
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
  return overlapX > config.overlapToleranceStuds && overlapZ > config.overlapToleranceStuds;
}

/** The poses to try, the as-asked pose first and then the cheapest shifts; a seeded jitter orders equal costs. */
function candidatePoses(seed: number): Pose[] {
  const { maxExtraGridSteps, maxLateralGridSteps } = config.relationSearch;
  const random = createSeededRandom(seed);
  const poses: { pose: Pose; rank: number }[] = [];
  for (let extraSteps = 0; extraSteps <= maxExtraGridSteps; extraSteps += 1) {
    for (
      let lateralSteps = -maxLateralGridSteps;
      lateralSteps <= maxLateralGridSteps;
      lateralSteps += 1
    ) {
      // The jitter stays below 1, so a pose never ranks before a cheaper one.
      const rank = extraSteps + Math.abs(lateralSteps) + random() * 0.99;
      poses.push({ pose: { extraSteps, lateralSteps }, rank });
    }
  }
  const asked = poses.filter(({ pose }) => pose.extraSteps === 0 && pose.lateralSteps === 0);
  const others = poses.filter((entry) => !asked.includes(entry));
  others.sort((first, second) => first.rank - second.rank);
  return [...asked, ...others].map(({ pose }) => pose);
}

interface Search {
  resolution: Resolution;
  poses: Pose[];
  /** Every room and hallway standing so far: the unrelated rooms and the choices on the current path. */
  standing: RoomSpec[];
  /** Centers of the placed rooms: the unrelated ones and the choices on the current path. */
  centers: Map<string, RoomSpec>;
  chosen: Placement[];
  nodes: number;
  /** The collision of the deepest room the as-asked pose failed, for the error when nothing fits. */
  deepest: { index: number; message: string } | undefined;
}

/** The first room or hallway already standing that `placement` overlaps, if any. */
function collisionOf(search: Search, placement: Placement): [RoomSpec, RoomSpec] | undefined {
  for (const piece of [placement.room, placement.hallway]) {
    const other = search.standing.find((standing) => roomsOverlap(standing, piece));
    if (other) {
      return [other, piece];
    }
  }
  return undefined;
}

/**
 * Depth-first search over the related rooms in dependency order: each room tries its poses, as asked
 * first, and keeps the first that overlaps nothing standing; when a later room has no pose left, the
 * search backs up and the earlier room tries its next pose. Every pose keeps the relation: the room
 * stays on its side of the target and its hallway is at least as long as asked.
 */
function searchFrom(search: Search, index: number): boolean {
  const { resolution } = search;
  const link = resolution.links[index];
  if (link === undefined) {
    return true;
  }
  const target = search.centers.get(link.room.relation.to) as RoomSpec;
  for (const [poseIndex, pose] of search.poses.entries()) {
    search.nodes += 1;
    if (search.nodes > config.relationSearch.maxNodes) {
      throw new Error(
        `Rooms could not be placed without overlap within ${String(config.relationSearch.maxNodes)} tries; give a hallway more length or move a room.`,
      );
    }
    const placement = placeRelated(resolution.spec, link, target, pose);
    if (placement === undefined) {
      continue;
    }
    const collision = collisionOf(search, placement);
    if (collision) {
      if (poseIndex === 0 && index >= (search.deepest?.index ?? -1)) {
        const [first, second] = collision;
        search.deepest = {
          index,
          message: `Rooms "${first.name}" and "${second.name}" overlap; move one, change a hallway length or shrink a room.`,
        };
      }
      continue;
    }
    search.chosen.push(placement);
    search.standing.push(placement.room, placement.hallway);
    search.centers.set(placement.room.name, placement.room);
    if (searchFrom(search, index + 1)) {
      return true;
    }
    search.chosen.pop();
    search.standing.length -= 2;
    search.centers.delete(placement.room.name);
  }
  return false;
}

/**
 * Turns a spec whose rooms may be placed by relation into one whose rooms all have a center.
 * Rooms come in dependency order (a room after the one it relates to, otherwise in spec order),
 * the hallway rooms are appended, and each hallway's two rooms gain a matching door. A related room
 * that would overlap another room moves along its hallway or sideways in grid steps, picked by a
 * seeded search; an error names the overlap when no pose fits. Placed rooms are never checked
 * against each other, so placed-only specs build as before.
 */
export function resolveRelations(spec: RelationMapSpec): MapSpec {
  const resolution: Resolution = {
    spec,
    roomsByName: new Map(spec.rooms.map((room) => [room.name, room])),
    placed: new Map(),
    order: [],
    links: [],
  };
  const ordered = new Set<string>();
  const taken = new Set<string>();
  for (const room of spec.rooms) {
    orderRoom(resolution, room, [], ordered, taken);
  }
  const search: Search = {
    resolution,
    poses: candidatePoses(spec.seed ?? config.defaultSeed),
    standing: [...resolution.placed.values()],
    centers: new Map(resolution.placed),
    chosen: [],
    nodes: 0,
    deepest: undefined,
  };
  if (!searchFrom(search, 0)) {
    throw new Error(search.deepest?.message ?? "Rooms could not be placed without overlap.");
  }
  const hallways: RoomSpec[] = [];
  for (const [index, placement] of search.chosen.entries()) {
    const { relation } = (resolution.links[index] as Link).room;
    resolution.placed.set(placement.room.name, placement.room);
    hallways.push(placement.hallway);
    addDoor(resolution.placed, relation.to, placement.targetDoor);
    addDoor(resolution.placed, placement.room.name, placement.roomDoor);
  }
  const rooms = resolution.order.map((name) => resolution.placed.get(name) as RoomSpec);
  return { ...spec, rooms: [...rooms, ...hallways] };
}
