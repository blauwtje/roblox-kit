import { config } from "../config.ts";
import type { Preset } from "../style/preset-schema.ts";
import type { CheckIssue } from "./check-report-store.ts";
import { layoutMap, type PartRecord } from "./map-layout.ts";
import type { RelationMapSpec, RoomSpec } from "./map-spec.ts";
import { resolveRelations } from "./relation-solver.ts";

/** The limits of a preset's size rules that a layout is measured against. */
export type SizeRules = Pick<
  Preset["sizeRules"],
  "minDoorwayWidth" | "minHallwayWidth" | "minWallHeight"
>;

type Side = "north" | "south" | "east" | "west";

/** Gaps narrower than this are rounding, not doorways. */
const GAP_EPSILON_STUDS = 1e-6;

/** The sign of each side's wall along the axis it stands across: north is toward -Z, east toward +X. */
const sideSigns: Record<Side, number> = { north: -1, south: 1, east: 1, west: -1 };

interface RoomParts {
  name: string;
  floor: PartRecord;
  walls: PartRecord[];
}

function roomsOf(parts: PartRecord[]): RoomParts[] {
  const rooms = new Map<string, RoomParts>();
  for (const part of parts) {
    const room = rooms.get(part.room) ?? {
      name: part.room,
      floor: part,
      walls: [],
    };
    if (part.kind === "floor") {
      room.floor = part;
    }
    if (part.kind === "wall") {
      room.walls.push(part);
    }
    rooms.set(part.room, room);
  }
  return [...rooms.values()];
}

function partPath(mapId: string, part: PartRecord): string {
  return `Workspace.${config.mapsFolderName}.${mapId}.${part.name}`;
}

/** Wall parts are named `<room><wallNameInfix><side>-<n>`. */
function sideOf(room: RoomParts, wall: PartRecord): Side {
  const suffix = wall.name.slice(room.name.length + config.wallNameInfix.length);
  return suffix.split("-")[0] as Side;
}

/** The openings between the wall parts of one side, each with its width and world center. */
function doorwaysOfSide(room: RoomParts, side: Side, walls: PartRecord[]) {
  const alongX = side === "north" || side === "south";
  const thickness = room.floor.size.y;
  // North and south walls span the full width; east and west walls fit between them.
  const span = alongX ? room.floor.size.x : room.floor.size.z - 2 * thickness;
  const across = (alongX ? room.floor.size.z : room.floor.size.x) / 2 - thickness / 2;
  const roomCenter = alongX ? room.floor.position.x : room.floor.position.z;
  const stretches = walls
    .map((wall) => {
      const center = (alongX ? wall.position.x : wall.position.z) - roomCenter;
      const length = alongX ? wall.size.x : wall.size.z;
      return { start: center - length / 2, end: center + length / 2 };
    })
    .sort((first, second) => first.start - second.start);
  const doorways: { width: number; position: { x: number; y: number; z: number } }[] = [];
  let cursor = -span / 2;
  for (const stretch of [...stretches, { start: span / 2, end: span / 2 }]) {
    const width = stretch.start - cursor;
    if (width > GAP_EPSILON_STUDS) {
      const alongCenter = roomCenter + cursor + width / 2;
      const acrossCenter =
        (alongX ? room.floor.position.z : room.floor.position.x) + sideSigns[side] * across;
      doorways.push({
        width,
        position: {
          x: alongX ? alongCenter : acrossCenter,
          y: 0,
          z: alongX ? acrossCenter : alongCenter,
        },
      });
    }
    cursor = Math.max(cursor, stretch.end);
  }
  return doorways;
}

function doorwayIssues(room: RoomParts, rules: SizeRules, mapId: string): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const sides: Side[] = ["north", "south", "east", "west"];
  for (const side of sides) {
    const walls = room.walls.filter((wall) => sideOf(room, wall) === side);
    const involved = walls.length > 0 ? walls : [room.floor];
    for (const doorway of doorwaysOfSide(room, side, walls)) {
      if (doorway.width < rules.minDoorwayWidth) {
        issues.push({
          kind: "sizeRule",
          parts: involved.map((part) => partPath(mapId, part)),
          position: doorway.position,
          detail: `Doorway on the ${side} wall of room "${room.name}" is ${String(doorway.width)} studs wide; the preset needs at least ${String(rules.minDoorwayWidth)}.`,
        });
      }
    }
  }
  return issues;
}

function wallHeightIssues(room: RoomParts, rules: SizeRules, mapId: string): CheckIssue[] {
  const [wall] = room.walls;
  if (wall === undefined || wall.size.y >= rules.minWallHeight) {
    return [];
  }
  return [
    {
      kind: "sizeRule",
      parts: [partPath(mapId, wall)],
      position: wall.position,
      detail: `Walls of room "${room.name}" are ${String(wall.size.y)} studs tall; the preset needs at least ${String(rules.minWallHeight)}.`,
    },
  ];
}

/** A hallway's doors face along its direction, so its width is the floor side across them. */
function hallwayWidthOf(hallway: RoomSpec, floor: PartRecord): number {
  const runsAlongX = hallway.doors.some((door) => door.side === "east" || door.side === "west");
  return runsAlongX ? floor.size.z : floor.size.x;
}

function hallwayWidthIssues(
  room: RoomParts,
  hallway: RoomSpec,
  rules: SizeRules,
  mapId: string,
): CheckIssue[] {
  const width = hallwayWidthOf(hallway, room.floor);
  if (width >= rules.minHallwayWidth) {
    return [];
  }
  return [
    {
      kind: "sizeRule",
      parts: [partPath(mapId, room.floor)],
      position: { ...room.floor.position, y: 0 },
      detail: `Hallway "${room.name}" is ${String(width)} studs wide; the preset needs at least ${String(rules.minHallwayWidth)}.`,
    },
  ];
}

/**
 * Doorways, hallways and walls of the map the spec lays out that are smaller than the preset's size rules.
 * The layout is the one build_map builds; hallways are the rooms that relations added to the spec.
 */
export function findSizeRuleIssues(
  spec: RelationMapSpec,
  rules: SizeRules,
  mapId: string,
): CheckIssue[] {
  const resolved = resolveRelations(spec);
  const hallways = new Map(resolved.rooms.map((room) => [room.name, room]));
  for (const room of spec.rooms) {
    hallways.delete(room.name);
  }
  const issues: CheckIssue[] = [];
  for (const room of roomsOf(layoutMap(resolved).parts)) {
    issues.push(...doorwayIssues(room, rules, mapId), ...wallHeightIssues(room, rules, mapId));
    const hallway = hallways.get(room.name);
    if (hallway !== undefined) {
      issues.push(...hallwayWidthIssues(room, hallway, rules, mapId));
    }
  }
  return issues;
}
