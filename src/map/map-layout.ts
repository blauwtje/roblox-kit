import { config } from "../config.ts";
import type { Preset } from "../style/preset-schema.ts";
import { createSeededRandom } from "../shared/seeded-random.ts";
import type { GraphMapSpec, GraphRoomSpec, MapSpec, RoomSpec, TerrainFill } from "./map-spec.ts";

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
  kind: "floor" | "wall" | "spawn" | "ceiling";
  /** The style surface the part is painted from. */
  role: SurfaceRole;
  /** A #rrggbb color: the style's color for `role`, or the shipped default without a style. */
  color: string;
  position: Vector;
  size: Vector;
  material: string;
}

/** The surface roles a part is painted from; each names a `surfaces` entry of a preset. */
export type SurfaceRole = keyof Preset["surfaces"];

interface SurfaceColor {
  color: string;
  material?: string;
}

/** The color, and optionally the material, of the surface roles a part can take; a preset's `surfaces` fits this shape. */
export type SurfaceColors = Record<"floor" | "wall", SurfaceColor> & {
  ceiling?: SurfaceColor;
  /** Marks the spawn pad; a style without it paints the pad as its floor. */
  accent?: SurfaceColor;
};

/** Neutral grays used when the map spec has no style. */
const defaultSurfaceColors: SurfaceColors = {
  floor: { color: "#8a8a8a" },
  wall: { color: "#b8b8b8" },
};

/** The ceiling color when ceilings are built from surfaces that name none. */
const defaultCeilingColor = "#d6d6d6";

export interface LayoutOptions {
  /** Adds one ceiling part per room, to be tagged `config.ceilingTag` when built; absent adds none. */
  ceilings?: boolean;
}

export interface MapLayout {
  parts: PartRecord[];
  terrainFills: TerrainFill[];
}

type Side = RoomSpec["doors"][number]["side"];

interface RoomStyle {
  floorMaterial: string;
  wallMaterial: string;
  ceilingMaterial: string;
  spawnMaterial: string;
  wallHeight: number;
  wallThickness: number;
  doorWidth: number;
  floorColor: string;
  wallColor: string;
  ceilingColor: string;
  spawnColor: string;
}

/** A stretch of wall, measured along the wall from its center. */
interface Interval {
  start: number;
  end: number;
}

const sides: Side[] = ["north", "south", "east", "west"];

/** Room settings win over map settings, which win over the style's surface material, which wins over the config defaults. */
function resolveStyle(spec: MapSpec, room: RoomSpec, surfaces: SurfaceColors): RoomStyle {
  const floorMaterial =
    room.floorMaterial ??
    spec.floorMaterial ??
    surfaces.floor.material ??
    config.defaultFloorMaterial;
  return {
    floorMaterial,
    wallMaterial:
      room.wallMaterial ??
      spec.wallMaterial ??
      surfaces.wall.material ??
      config.defaultWallMaterial,
    ceilingMaterial: surfaces.ceiling?.material ?? config.defaultCeilingMaterial,
    spawnMaterial: surfaces.accent?.material ?? floorMaterial,
    wallHeight: room.wallHeight ?? spec.wallHeight ?? config.defaultWallHeightStuds,
    wallThickness: room.wallThickness ?? spec.wallThickness ?? config.defaultWallThicknessStuds,
    doorWidth: room.doorWidth ?? spec.doorWidth ?? config.defaultDoorWidthStuds,
    floorColor: surfaces.floor.color,
    wallColor: surfaces.wall.color,
    ceilingColor: surfaces.ceiling?.color ?? defaultCeilingColor,
    spawnColor: surfaces.accent?.color ?? surfaces.floor.color,
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
        role: "wall",
        color: style.wallColor,
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
    role: "floor",
    color: style.floorColor,
    position: { x: room.x, y: config.floorLiftStuds - style.wallThickness / 2, z: room.z },
    size: { x: room.width, y: style.wallThickness, z: room.depth },
    material: style.floorMaterial,
  };
}

/** A slab over the whole footprint, resting on top of the walls. */
function ceilingPart(room: RoomSpec, style: RoomStyle): PartRecord {
  return {
    name: `${room.name}${config.ceilingNameSuffix}`,
    room: room.name,
    kind: "ceiling",
    role: "ceiling",
    color: style.ceilingColor,
    position: { x: room.x, y: style.wallHeight + style.wallThickness / 2, z: room.z },
    size: { x: room.width, y: style.wallThickness, z: room.depth },
    material: style.ceilingMaterial,
  };
}

/** A pad as wide as a door, standing on the floor at the room center, in the accent surface. */
function spawnPart(room: RoomSpec, style: RoomStyle): PartRecord {
  return {
    name: `${room.name}${config.spawnNameSuffix}`,
    room: room.name,
    kind: "spawn",
    role: "accent",
    color: style.spawnColor,
    position: { x: room.x, y: style.wallThickness / 2, z: room.z },
    size: { x: style.doorWidth, y: style.wallThickness, z: style.doorWidth },
    material: style.spawnMaterial,
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

type Door = RoomSpec["doors"][number];
type Axis = "x" | "z";

/** A room the graph solver has given a center, with the doors it holds so far. */
interface Placement {
  room: GraphRoomSpec;
  x: number;
  z: number;
  doors: Door[];
}

const sideSteps: Record<Side, { axis: Axis; sign: 1 | -1; opposite: Side }> = {
  north: { axis: "z", sign: -1, opposite: "south" },
  south: { axis: "z", sign: 1, opposite: "north" },
  east: { axis: "x", sign: 1, opposite: "west" },
  west: { axis: "x", sign: -1, opposite: "east" },
};
const otherAxisOf = { x: "z", z: "x" } as const;
const extentOf = { x: "width", z: "depth" } as const;

interface GraphContext {
  spec: GraphMapSpec;
  random: () => number;
  /** Rooms in the order the solver places them: each after a room it has an edge to. */
  order: GraphRoomSpec[];
  neighbors: Map<string, string[]>;
}

function graphDoorWidth(spec: GraphMapSpec, room: GraphRoomSpec): number {
  return room.doorWidth ?? spec.doorWidth ?? config.defaultDoorWidthStuds;
}

function graphWallThickness(spec: GraphMapSpec, room: GraphRoomSpec): number {
  return room.wallThickness ?? spec.wallThickness ?? config.defaultWallThicknessStuds;
}

/** Orders rooms breadth-first from the first one, so each follows a room it joins; a room the graph does not reach is an error. */
function graphContext(spec: GraphMapSpec): GraphContext {
  const neighbors = new Map<string, string[]>(spec.rooms.map((room) => [room.name, []]));
  for (const edge of spec.graph.edges) {
    neighbors.get(edge.a)?.push(edge.b);
    neighbors.get(edge.b)?.push(edge.a);
  }
  const roomsByName = new Map(spec.rooms.map((room) => [room.name, room]));
  const first = spec.rooms[0];
  if (!first) {
    throw new Error("A map needs at least one room.");
  }
  const order: GraphRoomSpec[] = [first];
  const reached = new Set([first.name]);
  for (const room of order) {
    for (const name of neighbors.get(room.name) ?? []) {
      const neighbor = roomsByName.get(name);
      if (neighbor && !reached.has(name)) {
        reached.add(name);
        order.push(neighbor);
      }
    }
  }
  const unreached = spec.rooms.filter((room) => !reached.has(room.name));
  if (unreached.length > 0) {
    throw new Error(
      `The room graph is not connected: ${unreached.map((room) => `"${room.name}"`).join(", ")} has no path of edges to "${first.name}".`,
    );
  }
  for (const edge of spec.graph.edges) {
    const widthA = graphDoorWidth(spec, roomsByName.get(edge.a) as GraphRoomSpec);
    const widthB = graphDoorWidth(spec, roomsByName.get(edge.b) as GraphRoomSpec);
    if (widthA !== widthB) {
      throw new Error(
        `Rooms "${edge.a}" and "${edge.b}" are joined but their doors are ${String(widthA)} and ${String(widthB)} wide; set the same doorWidth on both.`,
      );
    }
  }
  return { spec, random: createSeededRandom(spec.seed ?? config.defaultSeed), order, neighbors };
}

/** How far two rooms' footprints overlap along one axis; negative when apart. */
function overlapOnAxis(first: Placement, second: Placement, axis: Axis): number {
  const reach = (placement: Placement) => placement.room[extentOf[axis]] / 2;
  return reach(first) + reach(second) - Math.abs(first[axis] - second[axis]);
}

/**
 * The doors that join `placement` to `other` when they stand face to face and a door fits
 * in the stretch of wall they share, with a wall thickness of margin each side; otherwise undefined.
 */
function joiningDoors(
  context: GraphContext,
  placement: Placement,
  other: Placement,
): { own: Door; theirs: Door } | undefined {
  for (const [side, step] of Object.entries(sideSteps) as [Side, (typeof sideSteps)[Side]][]) {
    const { axis, sign, opposite } = step;
    const across = otherAxisOf[axis];
    const gap = sign * (other[axis] - placement[axis]) - placement.room[extentOf[axis]] / 2;
    const faceGap = gap - other.room[extentOf[axis]] / 2;
    if (Math.abs(faceGap) > config.overlapToleranceStuds) {
      continue;
    }
    const width = graphDoorWidth(context.spec, placement.room);
    const margin = 2 * graphWallThickness(context.spec, placement.room);
    if (overlapOnAxis(placement, other, across) < width + margin) {
      return undefined;
    }
    const low = Math.max(
      placement[across] - placement.room[extentOf[across]] / 2,
      other[across] - other.room[extentOf[across]] / 2,
    );
    const high = Math.min(
      placement[across] + placement.room[extentOf[across]] / 2,
      other[across] + other.room[extentOf[across]] / 2,
    );
    const center = (low + high) / 2;
    return {
      own: { side, offset: center - placement[across] },
      theirs: { side: opposite, offset: center - other[across] },
    };
  }
  return undefined;
}

/** Whether a door at `offset` on `side` clears the doors a room holds; all doors of a room share its door width. */
function doorClears(doors: Door[], door: Door, width: number): boolean {
  return doors.every(
    (held) => held.side !== door.side || Math.abs(held.offset - door.offset) >= width,
  );
}

/** The placements that add `room` to `placed`: face to face with an edge neighbor, joined by a door to every placed neighbor, overlapping no room. */
function extendPlacements(
  context: GraphContext,
  placed: Placement[],
  room: GraphRoomSpec,
): Placement[][] {
  const anchorName = context.neighbors
    .get(room.name)
    ?.find((name) => placed.some((p) => p.room.name === name));
  const anchor = placed.find((placement) => placement.room.name === anchorName);
  if (!anchor) {
    return [];
  }
  const width = graphDoorWidth(context.spec, room);
  const results: Placement[][] = [];
  for (const step of Object.values(sideSteps)) {
    const { axis, sign } = step;
    const across = otherAxisOf[axis];
    const alongCenter =
      anchor[axis] + sign * (anchor.room[extentOf[axis]] / 2 + room[extentOf[axis]] / 2);
    const slack = (anchor.room[extentOf[across]] - room[extentOf[across]]) / 2;
    for (const shift of [0, -slack, slack]) {
      const candidate: Placement = {
        room,
        x: 0,
        z: 0,
        doors: [...room.doors],
        [axis]: alongCenter,
        [across]: anchor[across] + shift,
      };
      if (
        placed.some(
          (other) =>
            overlapOnAxis(candidate, other, "x") > config.overlapToleranceStuds &&
            overlapOnAxis(candidate, other, "z") > config.overlapToleranceStuds,
        )
      ) {
        continue;
      }
      const updated = placed.map((placement) => ({ ...placement, doors: [...placement.doors] }));
      let joinsAll = true;
      for (const name of context.neighbors.get(room.name) ?? []) {
        const neighbor = updated.find((placement) => placement.room.name === name);
        if (!neighbor) {
          // Not placed yet: its own turn joins it.
          continue;
        }
        const doors = joiningDoors(context, candidate, neighbor);
        if (!doors) {
          joinsAll = false;
          break;
        }
        const clear =
          doorClears(candidate.doors, doors.own, width) &&
          doorClears(neighbor.doors, doors.theirs, width);
        if (!clear) {
          joinsAll = false;
          break;
        }
        candidate.doors.push(doors.own);
        neighbor.doors.push(doors.theirs);
      }
      if (joinsAll) {
        results.push([...updated, candidate]);
      }
    }
  }
  return results;
}

/** Shuffles in place with the given generator (Fisher-Yates). */
function shuffle<Item>(items: Item[], random: () => number): Item[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other] as Item, items[index] as Item];
  }
  return items;
}

/** Places the rooms from `placed.length` on, backtracking to the next candidate when a room has none. */
function placeRooms(context: GraphContext, placed: Placement[]): Placement[] | undefined {
  const room = context.order[placed.length];
  if (!room) {
    return placed;
  }
  for (const extended of shuffle(extendPlacements(context, placed, room), context.random)) {
    const solved = placeRooms(context, extended);
    if (solved) {
      return solved;
    }
  }
  return undefined;
}

/**
 * Gives each room of a graph spec a center so that every graph edge is a pair of rooms standing
 * face to face with matching doors, and no two rooms overlap. Candidates are tried in an order
 * the spec's seed fixes, so the same spec always yields the same map.
 */
export function solveRoomGraph(spec: GraphMapSpec): MapSpec {
  const context = graphContext(spec);
  const first = context.order[0] as GraphRoomSpec;
  const solved = placeRooms(context, [{ room: first, x: 0, z: 0, doors: [...first.doors] }]);
  if (!solved) {
    throw new Error(
      "No layout fits the room graph: the rooms cannot all stand face to face with a door each edge needs. Remove an edge that closes a loop, resize rooms or widen the walls they share.",
    );
  }
  const byName = new Map(solved.map((placement) => [placement.room.name, placement]));
  const rooms = spec.rooms.map((room) => {
    const placement = byName.get(room.name) as Placement;
    return { ...room, x: placement.x, z: placement.z, doors: placement.doors };
  });
  const placedSpec: MapSpec = { ...spec, rooms };
  // The placed spec is a plain map spec: without the graph, layoutMap does not solve it again.
  Reflect.deleteProperty(placedSpec, "graph");
  return placedSpec;
}

/** Turns a map spec, with a room graph solved to centers first, into parts and terrain fills; the same spec and surfaces always yield the same layout. */
export function layoutMap(
  input: MapSpec | GraphMapSpec,
  surfaces: SurfaceColors = defaultSurfaceColors,
  options: LayoutOptions = {},
): MapLayout {
  const spec = "graph" in input ? solveRoomGraph(input) : input;
  const parts: PartRecord[] = [];
  for (const room of spec.rooms) {
    const style = resolveStyle(spec, room, surfaces);
    assertRoomFits(room, style);
    parts.push(floorPart(room, style), ...wallParts(room, style));
    if (room.spawn) {
      parts.push(spawnPart(room, style));
    }
    if (options.ceilings) {
      parts.push(ceilingPart(room, style));
    }
  }
  return { parts, terrainFills: spec.terrain };
}
