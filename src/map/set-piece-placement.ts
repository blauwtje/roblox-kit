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
    throw new Error(
      `Room "${room.name}" has a door in every wall, so ${kind} has no wall to run along.`,
    );
  }
  return longest;
}

function assertFits(room: RoomSpec, kind: PropKind, free: number): void {
  if (free < 0) {
    throw new Error(
      `Room "${room.name}" is too small for its set piece ${kind}; enlarge the room.`,
    );
  }
}

/** Track bed against the wall and the platform edge in front of it, its warning strip facing the track. */
function trackPiece(
  room: RoomSpec,
  interior: RoomBounds,
  kind: "track-bed" | "platform-edge",
  seed: number,
): SetPieceRecord {
  const side = longestDoorlessWall(room, interior, kind);
  const { length, across } = wallSpan(interior, side);
  const trackDepth = propDimensions["track-bed"].z;
  const size = { ...propDimensions[kind], x: length - 2 * cornerReachStuds };
  const inset = kind === "track-bed" ? trackDepth / 2 : trackDepth + size.z / 2;
  assertFits(room, kind, size.x);
  assertFits(room, kind, across - trackDepth - propDimensions["platform-edge"].z);
  const facing = kind === "track-bed" ? oppositeSide[side] : side;
  return placed(room, interior, { kind, side, along: 0, inset, size, facing, seed });
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
 * that wall and inside +-`reach`; throws when the doorways leave no room.
 */
function alongClearOfDoors(
  room: RoomSpec,
  bounds: RoomBounds,
  side: Side,
  length: number,
  reach: number,
  preferred: number,
): number {
  const keepOut = bounds.doorWidth / 2 + propDimensions.clearanceStuds + length / 2;
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
    throw new Error(`Room "${room.name}" has no space on its ${side} wall clear of the doorways.`);
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
  const along = alongClearOfDoors(room, interior, side, size.x, reach, entry?.offset ?? 0);
  const inset = propDimensions.clearanceStuds + size.z / 2;
  return placed(room, interior, { kind, side, along, inset, size, facing: entrySide, seed });
}

/** A sign hung just inside a doorway, under the arch lintel and facing into the room. */
function signOverDoor(
  room: RoomSpec,
  interior: RoomBounds,
  door: Door,
  attributes: Record<string, string>,
  seed: number,
): SetPieceRecord {
  const size = propDimensions.sign;
  const height =
    interior.wallHeight - detailDimensions.archLintelHeightStuds - signLintelGapStuds - size.y / 2;
  const inset = detailDimensions.archDepthStuds + size.z / 2;
  const placement = {
    kind: "sign" as const,
    side: door.side,
    along: door.offset,
    inset,
    size,
    facing: oppositeSide[door.side],
    seed,
  };
  return placed(room, interior, placement, attributes, height);
}

function setPiecesOfRoom(
  spec: MapSpec,
  room: RoomSpec,
  roomTypes: NonNullable<Preset["roomTypes"]>,
  accent: string,
  seed: number,
): SetPieceRecord[] {
  const roomType = room.roomType === undefined ? undefined : roomTypes[room.roomType];
  if (roomType === undefined) {
    return [];
  }
  const interior = roomBounds(spec, room);
  const pieces = roomType.setPieces
    .filter((name) => name !== "sign")
    .map((name) => {
      const kind = setPieceKind(room, name);
      return kind === "track-bed" || kind === "platform-edge"
        ? trackPiece(room, interior, kind, seed)
        : pieceFacingEntry(room, interior, kind, seed);
    });
  const signAttributes = { Label: roomType.signLabel, AccentColor: accent };
  const signs = room.doors.map((door) => signOverDoor(room, interior, door, signAttributes, seed));
  return [...pieces, ...signs];
}

/**
 * The set pieces that say which place a typed room is: track bed and platform edge run along the longest
 * wall without a door, other pieces stand against the wall opposite the entry door (the room's first door)
 * looking at it, and every typed room gets a sign under the lintel of each door. Rooms without a type get none.
 * Throws on a piece with no generator or a room too small to hold one.
 */
export function placeSetPieces(
  spec: MapSpec,
  roomTypes: Preset["roomTypes"],
  accent: string,
  seed: number,
): SetPieceRecord[] {
  if (roomTypes === undefined) {
    return [];
  }
  return spec.rooms.flatMap((room) => setPiecesOfRoom(spec, room, roomTypes, accent, seed));
}
