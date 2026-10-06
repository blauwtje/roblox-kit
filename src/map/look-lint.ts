import { config } from "../config.ts";
import type { Preset } from "../style/preset-schema.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
import { propDimensions, roomBounds, type PropRecord, type RoomBounds } from "./prop-placement.ts";
import { findPropIssues } from "./prop-rules.ts";

/** A planned prop; set pieces and arrangement pieces carry a `yaw` in degrees, kit props none. */
export type PlannedProp = PropRecord & { yaw?: number };

export const lookIssueKinds = ["scale", "gap", "walkway", "doorway", "facing", "density"] as const;

/** One look problem of a planned map; it warns and never fails a build. */
export interface LookIssue {
  kind: (typeof lookIssueKinds)[number];
  /** The room the issue lies in. */
  zone: string;
  detail: string;
  /** A JSON merge patch of the build_map input that removes the issue; only walkway and doorway issues carry one. */
  suggestedSpecPatch?: { rooms: RoomSpec[] };
}

/** A prop's floor box in coordinates relative to its room's center. */
interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface PlacedProp {
  prop: PlannedProp;
  room: RoomSpec;
  box: Box;
}

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

function inRoom(room: RoomSpec, prop: PlannedProp): boolean {
  return (
    Math.abs(prop.pivot.x - room.x) <= room.width / 2 &&
    Math.abs(prop.pivot.z - room.z) <= room.depth / 2
  );
}

function boxOf(room: RoomSpec, prop: PlannedProp): Box {
  const radians = ((prop.yaw ?? 0) * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const halfX = (cosine * prop.size.x + sine * prop.size.z) / 2;
  const halfZ = (sine * prop.size.x + cosine * prop.size.z) / 2;
  const x = prop.pivot.x - room.x;
  const z = prop.pivot.z - room.z;
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

function withRoomReplaced(spec: MapSpec, replacement: RoomSpec): { rooms: RoomSpec[] } {
  return { rooms: spec.rooms.map((room) => (room.name === replacement.name ? replacement : room)) };
}

function scaleIssues(placed: PlacedProp[], preset: Preset): LookIssue[] {
  return placed.flatMap(({ prop, room }, index) =>
    findPropIssues(
      [
        {
          path: `${room.name}/${prop.kind}-${String(index)}`,
          kind: prop.kind,
          size: prop.size,
          position: prop.pivot,
          yaw: prop.yaw ?? 0,
          upright: true,
        },
      ],
      preset,
    )
      .filter((issue) => issue.kind === "scale")
      .map((issue) => ({ kind: "scale" as const, zone: room.name, detail: issue.detail })),
  );
}

/** The clear distance between two boxes that face each other across an axis; undefined when they overlap or lie diagonally. */
function clearDistance(first: Box, second: Box): number | undefined {
  const alongX = Math.max(first.minX - second.maxX, second.minX - first.maxX);
  const alongZ = Math.max(first.minZ - second.maxZ, second.minZ - first.maxZ);
  if (alongX > 0 && alongZ < 0) {
    return alongX;
  }
  if (alongZ > 0 && alongX < 0) {
    return alongZ;
  }
  return undefined;
}

/** A gap in the dead band; the placer's own clearance is deliberate spacing and not one. */
function isDeadGap(distance: number | undefined): distance is number {
  const { min, max } = config.lookLint.deadGapStuds;
  if (distance === undefined || distance < min || distance > max) {
    return false;
  }
  return Math.abs(distance - propDimensions.clearanceStuds) > config.overlapToleranceStuds;
}

function gapIssues(placed: PlacedProp[], spec: MapSpec): LookIssue[] {
  const issues: LookIssue[] = [];
  for (const [index, first] of placed.entries()) {
    const bounds = roomBounds(spec, first.room);
    const walls: Record<string, number> = {
      north: first.box.minZ + bounds.halfDepth,
      south: bounds.halfDepth - first.box.maxZ,
      west: first.box.minX + bounds.halfWidth,
      east: bounds.halfWidth - first.box.maxX,
    };
    for (const [side, distance] of Object.entries(walls)) {
      if (isDeadGap(distance)) {
        issues.push({
          kind: "gap",
          zone: first.room.name,
          detail: `${first.prop.kind} stands ${String(roundTenth(distance))} studs from the ${side} wall: too narrow to use, too wide to look flush.`,
        });
      }
    }
    for (const second of placed.slice(index + 1)) {
      const distance =
        first.room === second.room ? clearDistance(first.box, second.box) : undefined;
      if (isDeadGap(distance)) {
        issues.push({
          kind: "gap",
          zone: first.room.name,
          detail: `${first.prop.kind} and ${second.prop.kind} are ${String(roundTenth(distance))} studs apart: too narrow to use, too wide to look joined.`,
        });
      }
    }
  }
  return issues;
}

function walkwayIssues(spec: MapSpec): LookIssue[] {
  const issues: LookIssue[] = [];
  for (const room of spec.rooms) {
    const bounds = roomBounds(spec, room);
    const sides = new Set(room.doors.map((door) => door.side));
    const thickness = room.wallThickness ?? spec.wallThickness ?? config.defaultWallThicknessStuds;
    const crossings = [
      {
        open: sides.has("north") && sides.has("south"),
        width: 2 * bounds.halfWidth,
        from: "north",
        to: "south",
        extent: "width",
      },
      {
        open: sides.has("east") && sides.has("west"),
        width: 2 * bounds.halfDepth,
        from: "east",
        to: "west",
        extent: "depth",
      },
    ] as const;
    for (const crossing of crossings) {
      if (!crossing.open || crossing.width >= config.lookLint.minWalkwayStuds) {
        continue;
      }
      issues.push({
        kind: "walkway",
        zone: room.name,
        detail: `The walkway between the ${crossing.from} and ${crossing.to} doorways of room "${room.name}" is ${String(roundTenth(crossing.width))} studs wide; the lint wants at least ${String(config.lookLint.minWalkwayStuds)}.`,
        suggestedSpecPatch: withRoomReplaced(spec, {
          ...room,
          [crossing.extent]: config.lookLint.minWalkwayStuds + 2 * thickness,
        }),
      });
    }
  }
  return issues;
}

function doorwayIssues(spec: MapSpec, preset: Preset): LookIssue[] {
  const minimum = preset.sizeRules.minDoorwayWidth;
  return spec.rooms
    .filter((room) => room.doors.length > 0 && roomBounds(spec, room).doorWidth < minimum)
    .map((room) => ({
      kind: "doorway" as const,
      zone: room.name,
      detail: `Doorways of room "${room.name}" are ${String(roomBounds(spec, room).doorWidth)} studs wide; the preset needs at least ${String(minimum)}.`,
      suggestedSpecPatch: withRoomReplaced(spec, { ...room, doorWidth: minimum }),
    }));
}

function facingIssues(placed: PlacedProp[]): LookIssue[] {
  const issues: LookIssue[] = [];
  for (const { prop, room } of placed) {
    if (prop.yaw === undefined || config.lookLint.facingExemptKinds.includes(prop.kind)) {
      continue;
    }
    // At yaw 0 the front looks north (-Z); a quarter turn counter-clockwise looks west (-X).
    const radians = (prop.yaw * Math.PI) / 180;
    const front = { x: -Math.sin(radians), z: -Math.cos(radians) };
    const towardCenter = { x: room.x - prop.pivot.x, z: room.z - prop.pivot.z };
    if (front.x * towardCenter.x + front.z * towardCenter.z < 0) {
      issues.push({
        kind: "facing",
        zone: room.name,
        detail: `${prop.kind} at (${String(roundTenth(prop.pivot.x))}, ${String(roundTenth(prop.pivot.z))}) faces away from the center of room "${room.name}".`,
      });
    }
  }
  return issues;
}

function floorAreaOf(bounds: RoomBounds): number {
  return 4 * bounds.halfWidth * bounds.halfDepth;
}

function densityIssues(placed: PlacedProp[], spec: MapSpec): LookIssue[] {
  const issues: LookIssue[] = [];
  const { min, max } = config.lookLint.propDensity;
  for (const room of spec.rooms) {
    const area = floorAreaOf(roomBounds(spec, room));
    if (area < config.lookLint.densityMinRoomAreaSquareStuds) {
      continue;
    }
    const covered = placed
      .filter((entry) => entry.room === room)
      .reduce((sum, { box }) => sum + (box.maxX - box.minX) * (box.maxZ - box.minZ), 0);
    const share = covered / area;
    if (share >= min && share <= max) {
      continue;
    }
    issues.push({
      kind: "density",
      zone: room.name,
      detail: `Props cover ${String(roundTenth(share * 100))}% of the floor of room "${room.name}"; the band is ${String(min * 100)}% to ${String(max * 100)}%.`,
    });
  }
  return issues;
}

/**
 * The look issues of a planned map: prop scale against the preset's rules, dead gaps, walkways and doorways,
 * props facing away from their room and prop density. It reads the plan only, so it runs before Studio is touched.
 */
export function findLookIssues(spec: MapSpec, props: PlannedProp[], preset: Preset): LookIssue[] {
  const placed = props.flatMap((prop) => {
    const room = spec.rooms.find((candidate) => inRoom(candidate, prop));
    return room === undefined ? [] : [{ prop, room, box: boxOf(room, prop) }];
  });
  return [
    ...scaleIssues(placed, preset),
    ...gapIssues(placed, spec),
    ...walkwayIssues(spec),
    ...doorwayIssues(spec, preset),
    ...facingIssues(placed),
    ...densityIssues(placed, spec),
  ];
}
