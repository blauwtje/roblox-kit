import { createSeededRandom } from "../shared/seeded-random.ts";
import { sides } from "./map-spec.ts";
import type { MapSpec, RoomSpec, Side } from "./map-spec.ts";
import {
  cornerFootprints,
  cornerReachStuds,
  doorwayFootprint,
  isPropKind,
  oppositeSide,
  overlaps,
  propDimensions,
  propKinds,
  propSize,
  yawFacing,
} from "./prop-placement.ts";
import type { Footprint } from "./prop-placement.ts";
import { pointOnWall, rotatedHalfExtents, roomFrame, runsAlongX, wallBox } from "./room-frame.ts";
import type { Box, RoomFrame } from "./room-frame.ts";
import type { SetPiecePlacement, SetPieceRecord } from "./set-piece-placement.ts";
import type { Preset } from "../style/preset-schema.ts";

type Arrangement = NonNullable<NonNullable<Preset["roomTypes"]>[string]["arrangements"]>[number];

type ShapeOf<Shape extends Arrangement["shape"]> = Extract<Arrangement, { shape: Shape }>;

interface Fit {
  room: RoomSpec;
  frame: RoomFrame;
  size: PieceSize;
}

interface Slot {
  x: number;
  z: number;
  facing: Side;
}

/** How far past the room center a track bed lies for it to count as against a long wall. */
const trackWallMinOffsetStuds = 1;

/** The floor box a piece covers: its X length and Z depth swap when it is turned a quarter. */
function footprintOf(piece: SetPieceRecord): Box {
  const { halfX, halfZ } = rotatedHalfExtents(piece.size, piece.yaw);
  return {
    minX: piece.pivot.x - halfX,
    maxX: piece.pivot.x + halfX,
    minZ: piece.pivot.z - halfZ,
    maxZ: piece.pivot.z + halfZ,
  };
}

/** Offsets centered on 0, one per `spacing` studs of `span`, so a doubled span holds twice the offsets. */
function centeredOffsets(span: number, spacing: number): number[] {
  const count = Math.max(0, Math.floor(span / spacing));
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * spacing);
}

/** A room-local footprint moved to the room's place in the world. */
function inWorld(frame: RoomFrame, footprint: Footprint): Box {
  return {
    minX: frame.x + footprint.minX,
    maxX: frame.x + footprint.maxX,
    minZ: frame.z + footprint.minZ,
    maxZ: frame.z + footprint.maxZ,
  };
}

/** Floor a piece never covers: the corner pillars, each doorway strip and door lane, and a spawn pad. */
function keepOutBoxes(room: RoomSpec, frame: RoomFrame): Box[] {
  const clearance = propDimensions.clearanceStuds;
  const boxes: Box[] = cornerFootprints(frame).map((corner) => inWorld(frame, corner));
  for (const door of room.doors) {
    const centerDepth = runsAlongX(door.side) ? frame.halfDepth : frame.halfWidth;
    const laneHalf = frame.doorWidth / 2;
    boxes.push(inWorld(frame, doorwayFootprint(frame, door)));
    boxes.push(
      wallBox(frame, door.side, {
        alongMin: door.offset - laneHalf,
        alongMax: door.offset + laneHalf,
        depth: centerDepth,
      }),
    );
  }
  if (room.spawn) {
    const half = frame.doorWidth / 2 + clearance;
    boxes.push({
      minX: frame.x - half,
      maxX: frame.x + half,
      minZ: frame.z - half,
      maxZ: frame.z + half,
    });
  }
  return boxes;
}

/** The side of the room's first door the rows face: the door's end of the long axis, or the end nearest its offset. */
function rowFacing(room: RoomSpec, longAxisIsX: boolean): Side {
  const negative: Side = longAxisIsX ? "west" : "north";
  const positive: Side = longAxisIsX ? "east" : "south";
  const entry = room.doors[0];
  if (entry === undefined) {
    return positive;
  }
  if (entry.side === negative || entry.side === positive) {
    return entry.side;
  }
  return entry.offset < 0 ? negative : positive;
}

/** The long wall the room's track bed is against, when it is against one. */
function trackWallOf(
  frame: RoomFrame,
  roomPieces: SetPieceRecord[],
  walls: Side[],
): Side | undefined {
  const trackBed = roomPieces.find((piece) => piece.kind === "track-bed");
  if (trackBed === undefined) {
    return undefined;
  }
  return walls.find((side) => {
    const offset = runsAlongX(side) ? trackBed.pivot.z - frame.z : trackBed.pivot.x - frame.x;
    const towardSide = side === "north" || side === "west" ? -offset : offset;
    return towardSide > trackWallMinOffsetStuds;
  });
}

function wallSlot(
  frame: RoomFrame,
  side: Side,
  { along, inset, depth }: { along: number; inset: number; depth: number },
): Slot {
  const point = pointOnWall(frame, side, { along, inset: inset + depth / 2 });
  return { ...point, facing: oppositeSide[side] };
}

function gridSlots(frame: RoomFrame, spacing: number): Slot[] {
  const reach = 2 * cornerReachStuds;
  const columns = centeredOffsets(2 * frame.halfWidth - reach, spacing);
  const rows = centeredOffsets(2 * frame.halfDepth - reach, spacing);
  return columns.flatMap((x) =>
    rows.map((z) => ({ x: frame.x + x, z: frame.z + z, facing: "north" as const })),
  );
}

function rowSlots({ room, frame, size }: Fit, { spacing, perRow }: ShapeOf<"rows">): Slot[] {
  const longAxisIsX = isLongAxisX(frame);
  const longHalf = longAxisIsX ? frame.halfWidth : frame.halfDepth;
  const rowOffsets = centeredOffsets(2 * longHalf - 2 * cornerReachStuds, spacing);
  const pitch = size.x + propDimensions.clearanceStuds;
  const facing = rowFacing(room, longAxisIsX);
  return rowOffsets.flatMap((row) =>
    Array.from({ length: perRow }, (_, index) => {
      const across = (index - (perRow - 1) / 2) * pitch;
      return longAxisIsX
        ? { x: frame.x + row, z: frame.z + across, facing }
        : { x: frame.x + across, z: frame.z + row, facing };
    }),
  );
}

function wallSlots(
  { room, frame, size }: Fit,
  { spacing, walls, inset }: ShapeOf<"along-walls">,
): Slot[] {
  return sides
    .filter((side) => walls === "all" || !room.doors.some((door) => door.side === side))
    .flatMap((side) => {
      const length = 2 * (runsAlongX(side) ? frame.halfWidth : frame.halfDepth);
      return centeredOffsets(length - 2 * cornerReachStuds, spacing).map((along) =>
        wallSlot(frame, side, { along, inset, depth: size.z }),
      );
    });
}

function isLongAxisX(frame: RoomFrame): boolean {
  return frame.halfWidth >= frame.halfDepth;
}

function longWallsOf(frame: RoomFrame): Side[] {
  return isLongAxisX(frame) ? ["north", "south"] : ["west", "east"];
}

function lengthSlots(
  frame: RoomFrame,
  size: PieceSize,
  spacing: number,
  inset: number | undefined,
  trackWall: Side | undefined,
): Slot[] {
  const longAxisIsX = isLongAxisX(frame);
  const longHalf = longAxisIsX ? frame.halfWidth : frame.halfDepth;
  const wall = longWallsOf(frame).find((side) => side !== trackWall) ?? "north";
  const offsets = centeredOffsets(2 * longHalf - 2 * cornerReachStuds, spacing);
  if (inset !== undefined) {
    return offsets.map((along) => wallSlot(frame, wall, { along, inset, depth: size.z }));
  }
  const facing = oppositeSide[wall];
  return offsets.map((along) =>
    longAxisIsX
      ? { x: frame.x + along, z: frame.z, facing }
      : { x: frame.x, z: frame.z + along, facing },
  );
}

type PieceSize = SetPieceRecord["size"];

/** Like `centeredOffsets` but with an even count, so no offset sits on the center line. */
function pairedOffsets(span: number, spacing: number): number[] {
  const count = Math.floor(span / spacing);
  const evenCount = count - (count % 2);
  return Array.from({ length: evenCount }, (_, index) => (index - (evenCount - 1) / 2) * spacing);
}

function colonnadeSlots(frame: RoomFrame, size: PieceSize, spacing: number, inset: number): Slot[] {
  const longHalf = isLongAxisX(frame) ? frame.halfWidth : frame.halfDepth;
  const alongOffsets = pairedOffsets(2 * longHalf - 2 * cornerReachStuds, spacing);
  return longWallsOf(frame).flatMap((side) =>
    alongOffsets.map((along) => wallSlot(frame, side, { along, inset, depth: size.z })),
  );
}

function bankSlots({ room, frame, size }: Fit, { count, inset }: ShapeOf<"bank">): Slot[] {
  const doorless = (side: Side): boolean => !room.doors.some((door) => door.side === side);
  const longWalls = longWallsOf(frame);
  const shortWalls = sides.filter((side) => !longWalls.includes(side));
  const wall = [...shortWalls, ...longWalls].find(doorless);
  if (wall === undefined) {
    return [];
  }
  return Array.from({ length: count }, (_, index) => {
    const along = (index - (count - 1) / 2) * size.x;
    return wallSlot(frame, wall, { along, inset, depth: size.z });
  });
}

function slotsOf(fit: Fit, arrangement: Arrangement, trackWall: Side | undefined): Slot[] {
  const { frame, size } = fit;
  switch (arrangement.shape) {
    case "grid":
      return gridSlots(frame, arrangement.spacing);
    case "rows":
      return rowSlots(fit, arrangement);
    case "along-walls":
      return wallSlots(fit, arrangement);
    case "along-length":
      return lengthSlots(frame, size, arrangement.spacing, arrangement.inset, trackWall);
    case "colonnade":
      return colonnadeSlots(frame, size, arrangement.spacing, arrangement.inset);
    case "bank":
      return bankSlots(fit, arrangement);
  }
}

function insideRoom(frame: RoomFrame, box: Box): boolean {
  return (
    box.minX >= frame.x - frame.halfWidth &&
    box.maxX <= frame.x + frame.halfWidth &&
    box.minZ >= frame.z - frame.halfDepth &&
    box.maxZ <= frame.z + frame.halfDepth
  );
}

/**
 * Places one arrangement's pieces in slot order, adding each piece's box to `blocked`. Each slot draws its
 * piece's seed from the room's `random`, so a row of one generator does not come out identical.
 */
function placeArrangement(
  room: RoomSpec,
  frame: RoomFrame,
  arrangement: Arrangement,
  roomPieces: SetPieceRecord[],
  blocked: Box[],
  random: () => number,
): SetPieceRecord[] {
  if (!isPropKind(arrangement.piece)) {
    throw new Error(
      `Room "${room.name}" arranges "${arrangement.piece}", which has no generator; use one of ${propKinds.join(", ")}.`,
    );
  }
  const size = propSize(arrangement.piece, frame.wallHeight);
  const trackWall = trackWallOf(frame, roomPieces, longWallsOf(frame));
  const cap = "max" in arrangement ? (arrangement.max ?? Infinity) : Infinity;
  const blockedBefore = blocked.length;
  const pieces: SetPieceRecord[] = [];
  for (const slot of slotsOf({ room, frame, size }, arrangement, trackWall)) {
    if (pieces.length >= cap) {
      break;
    }
    const piece: SetPieceRecord = {
      kind: arrangement.piece,
      pivot: { x: slot.x, y: size.y / 2, z: slot.z },
      size,
      seed: Math.floor(random() * 2 ** 31),
      yaw: yawFacing[slot.facing],
      attributes: {},
    };
    const footprint = footprintOf(piece);
    if (insideRoom(frame, footprint) && !blocked.some((box) => overlaps(footprint, box))) {
      pieces.push(piece);
      blocked.push(footprint);
    }
  }
  if (arrangement.shape === "bank" && pieces.length < arrangement.count) {
    blocked.length = blockedBefore;
    return [];
  }
  return pieces;
}

function arrangementsOfRoom(
  spec: MapSpec,
  room: RoomSpec,
  roomTypes: NonNullable<Preset["roomTypes"]>,
  setPieces: SetPieceRecord[],
  random: () => number,
): SetPiecePlacement {
  const arrangements = (room.roomType === undefined ? undefined : roomTypes[room.roomType])
    ?.arrangements;
  if (arrangements === undefined) {
    return { pieces: [], warnings: [] };
  }
  const frame = roomFrame(spec, room);
  const roomPieces = setPieces.filter(
    (piece) =>
      Math.abs(piece.pivot.x - frame.x) <= room.width / 2 &&
      Math.abs(piece.pivot.z - frame.z) <= room.depth / 2,
  );
  const blocked = [...keepOutBoxes(room, frame), ...roomPieces.map(footprintOf)];
  const pieces: SetPieceRecord[] = [];
  const warnings: string[] = [];
  for (const arrangement of arrangements) {
    const placed = placeArrangement(room, frame, arrangement, roomPieces, blocked, random);
    if (placed.length === 0) {
      warnings.push(
        `Room "${room.name}" has no space for its ${arrangement.shape} of ${arrangement.piece}; enlarge the room or loosen the spacing.`,
      );
    }
    pieces.push(...placed);
  }
  return { pieces, warnings };
}

/**
 * The pieces a typed room's room type arranges to fill the floor its set pieces leave: `grid`, `rows`,
 * `along-walls`, `along-length` and `colonnade` slots whose count grows with the room's floor, and `bank`,
 * whose count is fixed. A slot is dropped when it would leave the room or overlap a corner pillar, a doorway
 * strip, a door's lane to the room center, a spawn pad, a set piece or an earlier piece, except that a bank
 * drops all of its pieces when any slot fails; an arrangement that places nothing adds one warning. Rooms
 * without a type or without arrangements get none, and an arranged piece with no generator throws. Each piece
 * gets its own seed from its room's random stream, so the same spec and seed give the same layout.
 */
export function placeArrangements(
  spec: MapSpec,
  roomTypes: Preset["roomTypes"],
  setPieces: SetPieceRecord[],
  seed: number,
): SetPiecePlacement {
  if (roomTypes === undefined) {
    return { pieces: [], warnings: [] };
  }
  const placements = spec.rooms.map((room, roomIndex) =>
    arrangementsOfRoom(
      spec,
      room,
      roomTypes,
      setPieces,
      createSeededRandom(seed + roomIndex * propDimensions.roomSeedStride),
    ),
  );
  return {
    pieces: placements.flatMap((placement) => placement.pieces),
    warnings: placements.flatMap((placement) => placement.warnings),
  };
}
