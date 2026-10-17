import { archReach, detailDimensions } from "./room-details.ts";
import type { Vector } from "./map-layout.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
import {
  cornerReachStuds,
  oppositeSide,
  propDimensions,
  propKinds,
  propSize,
  yawFacing,
} from "./prop-placement.ts";
import type { PropKind, PropRecord } from "./prop-placement.ts";
import { pointOnWall, roomFrame, runsAlongX, sideOrder } from "./room-frame.ts";
import type { RoomFrame, Side } from "./room-frame.ts";
import type { Preset } from "../style/preset-schema.ts";
import type { DoorwayClearanceBox } from "./size-rules.ts";

import { createSeededRandom } from "../shared/seeded-random.ts";

type Door = RoomSpec["doors"][number];

/**
 * A set piece is a prop with a facing and generator attributes. `size` is the generator's own box (length
 * along its X, depth along its Z), not swapped for the wall it stands on; `yaw` turns the piece about Y.
 */
export interface SetPieceRecord extends PropRecord {
  /** Degrees about Y, counter-clockwise from above; at 0 the piece's -Z face looks north. */
  yaw: number;
  /** Generator attributes by name: a sign's `Label` and `AccentColor` (a hex color string). */
  attributes: Record<string, string>;
}

/** Set pieces placed, and one warning per piece skipped because its room has no space for it. */
export interface SetPiecePlacement {
  pieces: SetPieceRecord[];
  warnings: string[];
}

/** A set piece that does not fit its room: the room keeps its other pieces and this one is skipped. */
interface Misfit {
  warning: string;
}

function isMisfit(result: object): result is Misfit {
  return "warning" in result;
}

interface RoomContext {
  room: RoomSpec;
  frame: RoomFrame;
  nextSeed: () => number;
}

const seedRange = 2 ** 31;

/** Clear space kept below a sign's lintel. */
const signLintelGapStuds = 0.25;

/** Length of a wall's inner face and how deep the room is across it. */
function wallSpan(frame: RoomFrame, side: Side): { length: number; across: number } {
  const width = 2 * frame.halfWidth;
  const depth = 2 * frame.halfDepth;
  return runsAlongX(side) ? { length: width, across: depth } : { length: depth, across: width };
}

function setPieceKind(room: RoomSpec, name: string): PropKind {
  const kind = propKinds.find((candidate) => candidate === name);
  if (kind === undefined) {
    throw new Error(
      `Room "${room.name}" lists set piece "${name}", which has no generator; use one of ${propKinds.join(", ")}.`,
    );
  }
  return kind;
}

/** The longest wall with no door in it; the first in north, south, east, west order on a tie. */
function longestDoorlessWall({ room, frame }: RoomContext, kind: PropKind): Side | Misfit {
  const doorless = sideOrder.filter((side) => !room.doors.some((door) => door.side === side));
  const longest = doorless.reduce<Side | undefined>(
    (best, side) =>
      best === undefined || wallSpan(frame, side).length > wallSpan(frame, best).length
        ? side
        : best,
    undefined,
  );
  return (
    longest ?? {
      warning: `Room "${room.name}" has a door in every wall, so ${kind} has no wall to run along.`,
    }
  );
}

function tooSmall({ room }: RoomContext, kind: PropKind, free: number): Misfit | undefined {
  return free < 0
    ? { warning: `Room "${room.name}" is too small for its set piece ${kind}; enlarge the room.` }
    : undefined;
}

interface AlongSpan {
  /** Center of the span, in studs along the wall from the room center. */
  along: number;
  length: number;
}

function alongClearOfClearances(
  { room, frame }: RoomContext,
  side: Side,
  depth: number,
  reach: number,
  clearances: DoorwayClearanceBox[],
): AlongSpan | Misfit {
  const alongX = runsAlongX(side);
  const wallMiddle = pointOnWall(frame, side, { along: 0, inset: 0 });
  const pieceEnd = pointOnWall(frame, side, { along: 0, inset: depth });
  const centerAlong = alongX ? wallMiddle.x : wallMiddle.z;
  const acrossRange = alongX
    ? [Math.min(wallMiddle.z, pieceEnd.z), Math.max(wallMiddle.z, pieceEnd.z)]
    : [Math.min(wallMiddle.x, pieceEnd.x), Math.max(wallMiddle.x, pieceEnd.x)];
  const blocked = clearances
    .filter((box) => {
      const [low, high] = alongX ? [box.min.z, box.max.z] : [box.min.x, box.max.x];
      return low < (acrossRange[1] ?? 0) && high > (acrossRange[0] ?? 0);
    })
    .map((box) =>
      alongX
        ? { start: box.min.x - centerAlong, end: box.max.x - centerAlong }
        : { start: box.min.z - centerAlong, end: box.max.z - centerAlong },
    )
    .sort((first, second) => first.start - second.start);
  const free: { start: number; end: number }[] = [];
  let cursor = -reach;
  for (const box of blocked) {
    free.push({ start: cursor, end: Math.min(box.start, reach) });
    cursor = Math.max(cursor, box.end);
  }
  free.push({ start: cursor, end: reach });
  const [longest] = free
    .filter((stretch) => stretch.end > stretch.start)
    .sort((first, second) => second.end - second.start - (first.end - first.start));
  if (longest === undefined) {
    return {
      warning: `Room "${room.name}" has no stretch of its ${side} wall clear of the doorway clearance boxes.`,
    };
  }
  return { along: (longest.start + longest.end) / 2, length: longest.end - longest.start };
}

/** Studs a track piece stands away from its wall: the preset's `depth` for the kind, else the generator's own. */
function trackDepthOf(kind: "track-bed" | "platform-edge", propRules: Preset["propRules"]): number {
  return propRules[kind]?.depth ?? propDimensions[kind].z;
}

/**
 * Track bed against the wall and the platform edge in front of it, its warning strip facing the track. Both
 * span the same stretch of the wall, which stops short of any doorway clearance box reaching into their depth.
 */
function trackPiece(
  context: RoomContext,
  kind: "track-bed" | "platform-edge",
  clearances: DoorwayClearanceBox[],
  propRules: Preset["propRules"],
): SetPieceRecord | Misfit {
  const side = longestDoorlessWall(context, kind);
  if (typeof side !== "string") {
    return side;
  }
  const { length, across } = wallSpan(context.frame, side);
  const trackDepth = trackDepthOf("track-bed", propRules);
  const edgeDepth = trackDepthOf("platform-edge", propRules);
  const pieceDepth = trackDepth + edgeDepth;
  const small =
    tooSmall(context, kind, length - 2 * cornerReachStuds) ??
    tooSmall(context, kind, across - pieceDepth);
  if (small !== undefined) {
    return small;
  }
  const span = alongClearOfClearances(
    context,
    side,
    pieceDepth,
    length / 2 - cornerReachStuds,
    clearances,
  );
  if (isMisfit(span)) {
    return span;
  }
  const size = {
    ...propDimensions[kind],
    x: span.length,
    z: kind === "track-bed" ? trackDepth : edgeDepth,
  };
  const inset = kind === "track-bed" ? trackDepth / 2 : trackDepth + edgeDepth / 2;
  const facing = kind === "track-bed" ? oppositeSide[side] : side;
  return placed(context, { kind, side, along: span.along, inset, size, facing });
}

interface Placement {
  kind: PropKind;
  side: Side;
  along: number;
  inset: number;
  size: Vector;
  /** The side of the room the piece's -Z face looks toward. */
  facing: Side;
}

function placed(
  { frame, nextSeed }: RoomContext,
  placement: Placement,
  attributes: Record<string, string> = {},
  height?: number,
): SetPieceRecord {
  const { x, z } = pointOnWall(frame, placement.side, placement);
  return {
    kind: placement.kind,
    pivot: { x, y: height ?? placement.size.y / 2, z },
    size: placement.size,
    seed: nextSeed(),
    yaw: yawFacing[placement.facing],
    attributes,
  };
}

function alongClearOfDoors(
  { room, frame }: RoomContext,
  side: Side,
  length: number,
  reach: number,
  preferred: number,
  doorMargin = 0,
): number | Misfit {
  const keepOut = frame.doorWidth / 2 + doorMargin + propDimensions.clearanceStuds + length / 2;
  const doorOffsets = room.doors.filter((door) => door.side === side).map((door) => door.offset);
  const candidates = [
    preferred,
    ...doorOffsets.flatMap((offset) => [offset - keepOut, offset + keepOut]),
  ]
    .map((along) => Math.max(-reach, Math.min(reach, along)))
    .filter((along) => doorOffsets.every((offset) => Math.abs(along - offset) >= keepOut))
    .sort((first, second) => Math.abs(first - preferred) - Math.abs(second - preferred));
  const [nearest] = candidates;
  return (
    nearest ?? {
      warning: `Room "${room.name}" has no space on its ${side} wall clear of the doorways.`,
    }
  );
}

/** A piece against the wall opposite the room's entry door (its first door), looking at that door. */
function pieceFacingEntry(context: RoomContext, kind: PropKind): SetPieceRecord | Misfit {
  const { room, frame } = context;
  const entry: Door | undefined = room.doors[0];
  const entrySide = entry?.side ?? "south";
  const side = oppositeSide[entrySide];
  const size = propSize(kind, frame.wallHeight);
  const reach = wallSpan(frame, side).length / 2 - cornerReachStuds - size.x / 2;
  const small = tooSmall(context, kind, reach);
  if (small !== undefined) {
    return small;
  }
  // An east or west door has a blade sign beside it (signAtDoor), which a tall piece would cut through.
  const bladeMargin = runsAlongX(side) ? 0 : propDimensions.sign.z + propDimensions.clearanceStuds;
  const preferred = entry?.offset ?? 0;
  const along = alongClearOfDoors(context, side, size.x, reach, preferred, bladeMargin);
  if (typeof along !== "number") {
    return along;
  }
  const inset = propDimensions.clearanceStuds + size.z / 2;
  return placed(context, { kind, side, along, inset, size, facing: entrySide });
}

/**
 * A sign at a door, its label on both faces. On a north or south wall it hangs flat on the wall beside the
 * doorway, its back face on the room-side face of the wall, facing into the room. On an east or west wall it
 * sticks out from the wall beside the doorway as a blade sign with its faces toward north and south, where
 * the zone views look from. When doorways and corners leave that wall no space, it hangs in the doorway
 * under the arch lintel instead.
 */
function signAtDoor(
  context: RoomContext,
  door: Door,
  attributes: Record<string, string>,
): SetPieceRecord {
  const { frame } = context;
  const size = propDimensions.sign;
  const height =
    frame.wallHeight - detailDimensions.archLintelHeightStuds - signLintelGapStuds - size.y / 2;
  const inDoorway = {
    kind: "sign" as const,
    side: door.side,
    along: door.offset,
    inset: size.z / 2,
    size,
    facing: oppositeSide[door.side],
  };
  const flat = runsAlongX(door.side);
  const lengthAlongWall = flat ? size.x : size.z;
  const reach = wallSpan(frame, door.side).length / 2 - cornerReachStuds - lengthAlongWall / 2;
  const along = alongClearOfDoors(context, door.side, lengthAlongWall, reach, door.offset);
  if (typeof along !== "number") {
    return placed(context, inDoorway, attributes, height);
  }
  const beside = flat
    ? { ...inDoorway, along }
    : { ...inDoorway, along, inset: size.x / 2, facing: "north" as const };
  return placed(context, beside, attributes, height);
}

/** The pieces that stand free in the room, with a face toward north and one toward south. */
const standingKinds: ReadonlySet<PropKind> = new Set(["departure-board", "clock"]);

/**
 * A free-standing piece on the room's east-west center line, a quarter of the room's width west (slot 0) or
 * east (slot 1) of center, so the center stays free for a spawn. Its faces look north and south, where the
 * zone views look from, and it stays out of the doorway strip along every wall.
 */
function standingPiece(
  context: RoomContext,
  kind: PropKind,
  slot: number,
): SetPieceRecord | Misfit {
  const { room, frame, nextSeed } = context;
  const slotOffsets = [-frame.halfWidth / 2, frame.halfWidth / 2];
  const along = slotOffsets[slot];
  if (along === undefined) {
    return {
      warning: `Room "${room.name}" already holds ${String(slotOffsets.length)} standing pieces, so ${kind} has no spot left.`,
    };
  }
  const size = propSize(kind, frame.wallHeight);
  const doorway = propDimensions.doorwayDepthStuds;
  const small =
    tooSmall(context, kind, frame.halfWidth - doorway - Math.abs(along) - size.x / 2) ??
    tooSmall(context, kind, frame.halfDepth - doorway - size.z / 2);
  if (small !== undefined) {
    return small;
  }
  return {
    kind,
    pivot: { x: room.x + along, y: size.y / 2, z: room.z },
    size,
    seed: nextSeed(),
    yaw: yawFacing.north,
    attributes: {},
  };
}

/** The deepest recipe among the hero props that replace `kind`, 0 when none does. */
function heroDepthOf(kind: PropKind, heroProps: Preset["heroProps"]): number {
  const depths = Object.values(heroProps ?? {})
    .filter((recipe) => recipe.replaces === kind)
    .map((recipe) => recipe.size.depth);
  return Math.max(0, ...depths);
}

function boardBesideSouthDoor(
  context: RoomContext,
  door: Door,
  heroDepth: number,
): SetPieceRecord | Misfit {
  const { frame } = context;
  const kind = "departure-board";
  const size = propSize(kind, frame.wallHeight);
  const along = door.offset - archReach(frame) - propDimensions.clearanceStuds - size.x / 2;
  const reach = wallSpan(frame, "south").length / 2 - cornerReachStuds - size.x / 2;
  const small = tooSmall(context, kind, reach + along);
  if (small !== undefined) {
    return small;
  }
  // The extra micrometer keeps the hero board's back face from rounding past the wall in heroFits' exact test.
  const inset = Math.max(size.z, heroDepth) / 2 + 1e-6;
  return placed(context, { kind, side: "south", along, inset, size, facing: "north" });
}

function setPiecesOfRoom(
  spec: MapSpec,
  room: RoomSpec,
  roomIndex: number,
  roomTypes: NonNullable<Preset["roomTypes"]>,
  accent: string,
  seed: number,
  clearances: DoorwayClearanceBox[],
  propRules: Preset["propRules"],
  heroProps: Preset["heroProps"],
): SetPiecePlacement {
  const roomType = room.roomType === undefined ? undefined : roomTypes[room.roomType];
  if (roomType === undefined) {
    return { pieces: [], warnings: [] };
  }
  const random = createSeededRandom(seed + roomIndex * propDimensions.roomSeedStride);
  const context: RoomContext = {
    room,
    frame: roomFrame(spec, room),
    nextSeed: () => Math.floor(random() * seedRange),
  };
  const pieces: SetPieceRecord[] = [];
  const warnings: string[] = [];
  let standingSlot = 0;
  const southDoor = room.doors.find((door) => door.side === "south");
  for (const name of roomType.setPieces.filter((setPiece) => setPiece !== "sign")) {
    const kind = setPieceKind(room, name);
    let result: SetPieceRecord | Misfit;
    if (kind === "track-bed" || kind === "platform-edge") {
      result = trackPiece(context, kind, clearances, propRules);
    } else if (
      kind === "departure-board" &&
      southDoor !== undefined &&
      !pieces.some((piece) => piece.kind === kind)
    ) {
      result = boardBesideSouthDoor(context, southDoor, heroDepthOf(kind, heroProps));
    } else if (standingKinds.has(kind)) {
      result = standingPiece(context, kind, standingSlot);
      standingSlot += isMisfit(result) ? 0 : 1;
    } else {
      result = pieceFacingEntry(context, kind);
    }
    if (isMisfit(result)) {
      warnings.push(`${result.warning} The ${kind} is skipped.`);
    } else {
      pieces.push(result);
    }
  }
  const signAttributes = { Label: roomType.signLabel, AccentColor: accent };
  const signs = room.doors.map((door) => signAtDoor(context, door, signAttributes));
  return { pieces: [...pieces, ...signs], warnings };
}

/**
 * The set pieces that say which place a typed room is: track bed and platform edge run along the longest
 * wall without a door, a departure board stands against the south wall west of the room's south door (a room
 * without one, and a second board, stand it free on the room's center line like a clock), other pieces stand
 * against the wall opposite the entry door (the room's first door) looking at it, and every typed room gets a
 * sign at each door. Rooms without a type get none.
 * The track pieces stop short of the `clearances` (doorway clearance boxes of the map); without them a piece may
 * stand in a doorway's path. A `depth` on the track bed's or platform edge's entry in `propRules` sets how far
 * that piece stands from the wall in place of the generator's own depth. `heroProps` (the preset's) gives the
 * depth of the hero recipe that replaces the departure board, which sets how far the board stands off the wall.
 * A piece its room has no space for is skipped with a warning; a piece with no generator throws.
 */
export function placeSetPieces(
  spec: MapSpec,
  roomTypes: Preset["roomTypes"],
  accent: string,
  seed: number,
  clearances: DoorwayClearanceBox[] = [],
  propRules: Preset["propRules"] = {},
  heroProps: Preset["heroProps"] = {},
): SetPiecePlacement {
  if (roomTypes === undefined) {
    return { pieces: [], warnings: [] };
  }
  const placements = spec.rooms.map((room, roomIndex) =>
    setPiecesOfRoom(
      spec,
      room,
      roomIndex,
      roomTypes,
      accent,
      seed,
      clearances,
      propRules,
      heroProps,
    ),
  );
  return {
    pieces: placements.flatMap((placement) => placement.pieces),
    warnings: placements.flatMap((placement) => placement.warnings),
  };
}
