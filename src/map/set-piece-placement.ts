import { detailDimensions } from "./room-details.ts";
import type { Vector } from "./map-layout.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
import {
  cornerReachStuds,
  propDimensions,
  propKinds,
  propSize,
  roomBounds,
} from "./prop-placement.ts";
import type { PropKind, PropRecord, RoomBounds } from "./prop-placement.ts";
import type { Preset } from "../style/preset-schema.ts";
import type { DoorwayClearanceBox } from "./size-rules.ts";

type Side = RoomSpec["doors"][number]["side"];
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
class SetPieceMisfit extends Error {}

/** The yaw that turns a piece's -Z face toward each side of the room. */
const yawFacing: Record<Side, number> = { north: 0, west: 90, south: 180, east: 270 };

const oppositeSide: Record<Side, Side> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

const sideOrder: Side[] = ["north", "south", "east", "west"];

/** Clear space kept below a sign's lintel. */
const signLintelGapStuds = 0.25;

function runsAlongX(side: Side): boolean {
  return side === "north" || side === "south";
}

/** Length of a wall's inner face and how deep the room is across it. */
function wallSpan(interior: RoomBounds, side: Side): { length: number; across: number } {
  const width = 2 * interior.halfWidth;
  const depth = 2 * interior.halfDepth;
  return runsAlongX(side) ? { length: width, across: depth } : { length: depth, across: width };
}

/** World center of a point `along` a wall from the room center and `inset` studs in from its inner face. */
function pointOnWall(
  room: RoomSpec,
  interior: RoomBounds,
  side: Side,
  along: number,
  inset: number,
): { x: number; z: number } {
  switch (side) {
    case "north":
      return { x: room.x + along, z: room.z - interior.halfDepth + inset };
    case "south":
      return { x: room.x + along, z: room.z + interior.halfDepth - inset };
    case "west":
      return { x: room.x - interior.halfWidth + inset, z: room.z + along };
    case "east":
      return { x: room.x + interior.halfWidth - inset, z: room.z + along };
  }
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
function longestDoorlessWall(room: RoomSpec, interior: RoomBounds, kind: PropKind): Side {
  const doorless = sideOrder.filter((side) => !room.doors.some((door) => door.side === side));
  const longest = doorless.reduce<Side | undefined>(
    (best, side) =>
      best === undefined || wallSpan(interior, side).length > wallSpan(interior, best).length
        ? side
        : best,
    undefined,
  );
  if (longest === undefined) {
    throw new SetPieceMisfit(
      `Room "${room.name}" has a door in every wall, so ${kind} has no wall to run along.`,
    );
  }
  return longest;
}

function assertFits(room: RoomSpec, kind: PropKind, free: number): void {
  if (free < 0) {
    throw new SetPieceMisfit(
      `Room "${room.name}" is too small for its set piece ${kind}; enlarge the room.`,
    );
  }
}

interface AlongSpan {
  /** Center of the span, in studs along the wall from the room center. */
  along: number;
  length: number;
}

/**
 * The longest stretch of a wall within +-`reach` of its middle where a piece `depth` studs deep stays out of
 * every doorway clearance box; throws a SetPieceMisfit when the boxes leave no stretch. The boxes' heights are
 * ignored: they start at the floor, where the track pieces stand.
 */
function alongClearOfClearances(
  room: RoomSpec,
  interior: RoomBounds,
  side: Side,
  depth: number,
  reach: number,
  clearances: DoorwayClearanceBox[],
): AlongSpan {
  const alongX = runsAlongX(side);
  const wallMiddle = pointOnWall(room, interior, side, 0, 0);
  const pieceEnd = pointOnWall(room, interior, side, 0, depth);
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
    throw new SetPieceMisfit(
      `Room "${room.name}" has no stretch of its ${side} wall clear of the doorway clearance boxes.`,
    );
  }
  return { along: (longest.start + longest.end) / 2, length: longest.end - longest.start };
}

/**
 * Track bed against the wall and the platform edge in front of it, its warning strip facing the track. Both
 * span the same stretch of the wall, which stops short of any doorway clearance box reaching into their depth.
 */
function trackPiece(
  room: RoomSpec,
  interior: RoomBounds,
  kind: "track-bed" | "platform-edge",
  seed: number,
  clearances: DoorwayClearanceBox[],
): SetPieceRecord {
  const side = longestDoorlessWall(room, interior, kind);
  const { length, across } = wallSpan(interior, side);
  const trackDepth = propDimensions["track-bed"].z;
  const pieceDepth = trackDepth + propDimensions["platform-edge"].z;
  assertFits(room, kind, length - 2 * cornerReachStuds);
  assertFits(room, kind, across - pieceDepth);
  const span = alongClearOfClearances(
    room,
    interior,
    side,
    pieceDepth,
    length / 2 - cornerReachStuds,
    clearances,
  );
  const size = { ...propDimensions[kind], x: span.length };
  const inset = kind === "track-bed" ? trackDepth / 2 : trackDepth + size.z / 2;
  const facing = kind === "track-bed" ? oppositeSide[side] : side;
  return placed(room, interior, { kind, side, along: span.along, inset, size, facing, seed });
}

interface Placement {
  kind: PropKind;
  side: Side;
  along: number;
  inset: number;
  size: Vector;
  /** The side of the room the piece's -Z face looks toward. */
  facing: Side;
  seed: number;
}

function placed(
  room: RoomSpec,
  interior: RoomBounds,
  placement: Placement,
  attributes: Record<string, string> = {},
  height?: number,
): SetPieceRecord {
  const { x, z } = pointOnWall(room, interior, placement.side, placement.along, placement.inset);
  return {
    kind: placement.kind,
    pivot: { x, y: height ?? placement.size.y / 2, z },
    size: placement.size,
    seed: placement.seed,
    yaw: yawFacing[placement.facing],
    attributes,
  };
}

/**
 * The position along a wall nearest `preferred` where a piece of `length` stays out of every doorway on
 * that wall, widened by `doorMargin` on each side, and inside +-`reach`; throws a SetPieceMisfit when the
 * doorways leave no room.
 */
function alongClearOfDoors(
  room: RoomSpec,
  bounds: RoomBounds,
  side: Side,
  length: number,
  reach: number,
  preferred: number,
  doorMargin = 0,
): number {
  const keepOut = bounds.doorWidth / 2 + doorMargin + propDimensions.clearanceStuds + length / 2;
  const doorOffsets = room.doors.filter((door) => door.side === side).map((door) => door.offset);
  const candidates = [
    preferred,
    ...doorOffsets.flatMap((offset) => [offset - keepOut, offset + keepOut]),
  ]
    .map((along) => Math.max(-reach, Math.min(reach, along)))
    .filter((along) => doorOffsets.every((offset) => Math.abs(along - offset) >= keepOut))
    .sort((first, second) => Math.abs(first - preferred) - Math.abs(second - preferred));
  const [nearest] = candidates;
  if (nearest === undefined) {
    throw new SetPieceMisfit(
      `Room "${room.name}" has no space on its ${side} wall clear of the doorways.`,
    );
  }
  return nearest;
}

/** A piece against the wall opposite the room's entry door (its first door), looking at that door. */
function pieceFacingEntry(
  room: RoomSpec,
  interior: RoomBounds,
  kind: PropKind,
  seed: number,
): SetPieceRecord {
  const entry: Door | undefined = room.doors[0];
  const entrySide = entry?.side ?? "south";
  const side = oppositeSide[entrySide];
  const size = propSize(kind, interior.wallHeight);
  const reach = wallSpan(interior, side).length / 2 - cornerReachStuds - size.x / 2;
  assertFits(room, kind, reach);
  // An east or west door has a blade sign beside it (signAtDoor), which a tall piece would cut through.
  const bladeMargin = runsAlongX(side) ? 0 : propDimensions.sign.z + propDimensions.clearanceStuds;
  const preferred = entry?.offset ?? 0;
  const along = alongClearOfDoors(room, interior, side, size.x, reach, preferred, bladeMargin);
  const inset = propDimensions.clearanceStuds + size.z / 2;
  return placed(room, interior, { kind, side, along, inset, size, facing: entrySide, seed });
}

/**
 * A sign at a door, its label on both faces. On a north or south wall it hangs just inside the doorway under
 * the arch lintel, facing into the room. On an east or west wall it sticks out from the wall beside the doorway
 * as a blade sign with its faces toward north and south, where the zone views look from; when doorways and
 * corners leave that wall no space, it hangs in the doorway instead.
 */
function signAtDoor(
  room: RoomSpec,
  interior: RoomBounds,
  door: Door,
  attributes: Record<string, string>,
  seed: number,
): SetPieceRecord {
  const size = propDimensions.sign;
  const height =
    interior.wallHeight - detailDimensions.archLintelHeightStuds - signLintelGapStuds - size.y / 2;
  const inDoorway = {
    kind: "sign" as const,
    side: door.side,
    along: door.offset,
    inset: detailDimensions.archDepthStuds + size.z / 2,
    size,
    facing: oppositeSide[door.side],
    seed,
  };
  if (runsAlongX(door.side)) {
    return placed(room, interior, inDoorway, attributes, height);
  }
  const reach = wallSpan(interior, door.side).length / 2 - cornerReachStuds - size.z / 2;
  try {
    const along = alongClearOfDoors(room, interior, door.side, size.z, reach, door.offset);
    const blade = { ...inDoorway, along, inset: size.x / 2, facing: "north" as const };
    return placed(room, interior, blade, attributes, height);
  } catch (error) {
    if (!(error instanceof SetPieceMisfit)) {
      throw error;
    }
    return placed(room, interior, inDoorway, attributes, height);
  }
}

/** The pieces that stand free in the room, with a face toward north and one toward south. */
const standingKinds: ReadonlySet<PropKind> = new Set(["departure-board", "clock"]);

/**
 * A free-standing piece on the room's east-west center line, a quarter of the room's width west (slot 0) or
 * east (slot 1) of center, so the center stays free for a spawn. Its faces look north and south, where the
 * zone views look from, and it stays out of the doorway strip along every wall.
 */
function standingPiece(
  room: RoomSpec,
  interior: RoomBounds,
  kind: PropKind,
  slot: number,
  seed: number,
): SetPieceRecord {
  const slotOffsets = [-interior.halfWidth / 2, interior.halfWidth / 2];
  const along = slotOffsets[slot];
  if (along === undefined) {
    throw new SetPieceMisfit(
      `Room "${room.name}" already holds ${String(slotOffsets.length)} standing pieces, so ${kind} has no spot left.`,
    );
  }
  const size = propSize(kind, interior.wallHeight);
  const doorway = propDimensions.doorwayDepthStuds;
  assertFits(room, kind, interior.halfWidth - doorway - Math.abs(along) - size.x / 2);
  assertFits(room, kind, interior.halfDepth - doorway - size.z / 2);
  return {
    kind,
    pivot: { x: room.x + along, y: size.y / 2, z: room.z },
    size,
    seed,
    yaw: yawFacing.north,
    attributes: {},
  };
}

function setPiecesOfRoom(
  spec: MapSpec,
  room: RoomSpec,
  roomTypes: NonNullable<Preset["roomTypes"]>,
  accent: string,
  seed: number,
  clearances: DoorwayClearanceBox[],
): SetPiecePlacement {
  const roomType = room.roomType === undefined ? undefined : roomTypes[room.roomType];
  if (roomType === undefined) {
    return { pieces: [], warnings: [] };
  }
  const interior = roomBounds(spec, room);
  const pieces: SetPieceRecord[] = [];
  const warnings: string[] = [];
  let standingSlot = 0;
  for (const name of roomType.setPieces.filter((setPiece) => setPiece !== "sign")) {
    const kind = setPieceKind(room, name);
    try {
      if (kind === "track-bed" || kind === "platform-edge") {
        pieces.push(trackPiece(room, interior, kind, seed, clearances));
      } else if (standingKinds.has(kind)) {
        pieces.push(standingPiece(room, interior, kind, standingSlot, seed));
        standingSlot += 1;
      } else {
        pieces.push(pieceFacingEntry(room, interior, kind, seed));
      }
    } catch (error) {
      if (!(error instanceof SetPieceMisfit)) {
        throw error;
      }
      warnings.push(`${error.message} The ${kind} is skipped.`);
    }
  }
  const signAttributes = { Label: roomType.signLabel, AccentColor: accent };
  const signs = room.doors.map((door) => signAtDoor(room, interior, door, signAttributes, seed));
  return { pieces: [...pieces, ...signs], warnings };
}

/**
 * The set pieces that say which place a typed room is: track bed and platform edge run along the longest
 * wall without a door, a departure board and a clock stand free on the room's center line, other pieces stand
 * against the wall opposite the entry door (the room's first door) looking at it, and every typed room gets a
 * sign at each door. Rooms without a type get none.
 * The track pieces stop short of the `clearances` (doorway clearance boxes of the map); without them a piece may
 * stand in a doorway's path.
 * A piece its room has no space for is skipped with a warning; a piece with no generator throws.
 */
export function placeSetPieces(
  spec: MapSpec,
  roomTypes: Preset["roomTypes"],
  accent: string,
  seed: number,
  clearances: DoorwayClearanceBox[] = [],
): SetPiecePlacement {
  if (roomTypes === undefined) {
    return { pieces: [], warnings: [] };
  }
  const placements = spec.rooms.map((room) =>
    setPiecesOfRoom(spec, room, roomTypes, accent, seed, clearances),
  );
  return {
    pieces: placements.flatMap((placement) => placement.pieces),
    warnings: placements.flatMap((placement) => placement.warnings),
  };
}
