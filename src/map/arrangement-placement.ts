import { createSeededRandom } from "../shared/seeded-random.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
import {
  cornerFootprints,
  cornerReachStuds,
  doorwayFootprint,
  isPropKind,
  overlaps,
  propDimensions,
  propKinds,
  propSize,
  roomBounds,
} from "./prop-placement.ts";
import type { Footprint, RoomBounds } from "./prop-placement.ts";
import type { SetPiecePlacement, SetPieceRecord } from "./set-piece-placement.ts";
import type { Preset } from "../style/preset-schema.ts";

type Side = RoomSpec["doors"][number]["side"];
type Arrangement = NonNullable<NonNullable<Preset["roomTypes"]>[string]["arrangements"]>[number];

/** A rectangle on the floor plane in world coordinates. */
interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Where one piece could stand: an offset from the room center and the side its -Z face looks toward. */
interface Slot {
  x: number;
  z: number;
  facing: Side;
}

interface RoomFrame {
  room: RoomSpec;
  interior: RoomBounds;
}

// The yaw and side tables repeat those of set-piece-placement.ts, which does not export them.
const yawFacing: Record<Side, number> = { north: 0, west: 90, south: 180, east: 270 };
const oppositeSide: Record<Side, Side> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};
const sideOrder: Side[] = ["north", "south", "east", "west"];

/** How far past the room center a track bed lies for it to count as against a long wall. */
const trackWallMinOffsetStuds = 1;

function isHorizontalWall(side: Side): boolean {
  return side === "north" || side === "south";
}

/** The floor box a piece covers: its X length and Z depth swap when it is turned a quarter. */
function footprintOf(piece: SetPieceRecord): Box {
  const turned = piece.yaw === yawFacing.east || piece.yaw === yawFacing.west;
  const halfX = (turned ? piece.size.z : piece.size.x) / 2;
  const halfZ = (turned ? piece.size.x : piece.size.z) / 2;
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

/** The box `depth` studs into the room from `side`'s inner face, between two positions along that wall. */
function wallBox(
  { room, interior }: RoomFrame,
  side: Side,
  alongMin: number,
  alongMax: number,
  depth: number,
): Box {
  switch (side) {
    case "north":
      return {
        minX: room.x + alongMin,
        maxX: room.x + alongMax,
        minZ: room.z - interior.halfDepth,
        maxZ: room.z - interior.halfDepth + depth,
      };
    case "south":
      return {
        minX: room.x + alongMin,
        maxX: room.x + alongMax,
        minZ: room.z + interior.halfDepth - depth,
        maxZ: room.z + interior.halfDepth,
      };
    case "west":
      return {
        minX: room.x - interior.halfWidth,
        maxX: room.x - interior.halfWidth + depth,
        minZ: room.z + alongMin,
        maxZ: room.z + alongMax,
      };
    case "east":
      return {
        minX: room.x + interior.halfWidth - depth,
        maxX: room.x + interior.halfWidth,
        minZ: room.z + alongMin,
        maxZ: room.z + alongMax,
      };
  }
}

/** A room-local footprint moved to the room's place in the world. */
function inWorld(room: RoomSpec, footprint: Footprint): Box {
  return {
    minX: room.x + footprint.minX,
    maxX: room.x + footprint.maxX,
    minZ: room.z + footprint.minZ,
    maxZ: room.z + footprint.maxZ,
  };
}

/** Floor a piece never covers: the corner pillars, each doorway strip and door lane, and a spawn pad. */
function keepOutBoxes(frame: RoomFrame): Box[] {
  const { room, interior } = frame;
  const clearance = propDimensions.clearanceStuds;
  const boxes: Box[] = cornerFootprints(interior).map((corner) => inWorld(room, corner));
  for (const door of room.doors) {
    const centerDepth = isHorizontalWall(door.side) ? interior.halfDepth : interior.halfWidth;
    const laneHalf = interior.doorWidth / 2;
    boxes.push(inWorld(room, doorwayFootprint(interior, door)));
    boxes.push(
      wallBox(frame, door.side, door.offset - laneHalf, door.offset + laneHalf, centerDepth),
    );
  }
  if (room.spawn) {
    const half = interior.doorWidth / 2 + clearance;
    boxes.push({
      minX: room.x - half,
      maxX: room.x + half,
      minZ: room.z - half,
      maxZ: room.z + half,
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
  const { room } = frame;
  return walls.find((side) => {
    const offset = isHorizontalWall(side) ? trackBed.pivot.z - room.z : trackBed.pivot.x - room.x;
    const towardSide = side === "north" || side === "west" ? -offset : offset;
    return towardSide > trackWallMinOffsetStuds;
  });
}

/** Distance from the room center to a piece of depth `depth` standing `inset` studs off `side`'s wall. */
function offCenter(frame: RoomFrame, side: Side, inset: number, depth: number): number {
  const half = isHorizontalWall(side) ? frame.interior.halfDepth : frame.interior.halfWidth;
  const sign = side === "north" || side === "west" ? -1 : 1;
  return sign * (half - inset - depth / 2);
}

function gridSlots({ interior }: RoomFrame, spacing: number): Slot[] {
  const reach = 2 * cornerReachStuds;
  const columns = centeredOffsets(2 * interior.halfWidth - reach, spacing);
  const rows = centeredOffsets(2 * interior.halfDepth - reach, spacing);
  return columns.flatMap((x) => rows.map((z) => ({ x, z, facing: "north" as const })));
}

function rowSlots(frame: RoomFrame, size: PieceSize, spacing: number, perRow: number): Slot[] {
  const { room, interior } = frame;
  const longAxisIsX = interior.halfWidth >= interior.halfDepth;
  const longHalf = longAxisIsX ? interior.halfWidth : interior.halfDepth;
  const rowOffsets = centeredOffsets(2 * longHalf - 2 * cornerReachStuds, spacing);
  const pitch = size.x + propDimensions.clearanceStuds;
  const facing = rowFacing(room, longAxisIsX);
  return rowOffsets.flatMap((row) =>
    Array.from({ length: perRow }, (_, index) => {
      const across = (index - (perRow - 1) / 2) * pitch;
      return longAxisIsX ? { x: row, z: across, facing } : { x: across, z: row, facing };
    }),
  );
}

function wallSlots(
  frame: RoomFrame,
  size: PieceSize,
  spacing: number,
  walls: "doorless" | "all",
  inset: number,
): Slot[] {
  const { room, interior } = frame;
  const sides = sideOrder.filter(
    (side) => walls === "all" || !room.doors.some((door) => door.side === side),
  );
  return sides.flatMap((side) => {
    const length = isHorizontalWall(side) ? 2 * interior.halfWidth : 2 * interior.halfDepth;
    const across = offCenter(frame, side, inset, size.z);
    return centeredOffsets(length - 2 * cornerReachStuds, spacing).map((along) =>
      isHorizontalWall(side)
        ? { x: along, z: across, facing: oppositeSide[side] }
        : { x: across, z: along, facing: oppositeSide[side] },
    );
  });
}

function lengthSlots(
  frame: RoomFrame,
  size: PieceSize,
  spacing: number,
  inset: number | undefined,
  trackWall: Side | undefined,
): Slot[] {
  const { interior } = frame;
  const longAxisIsX = interior.halfWidth >= interior.halfDepth;
  const longWalls: Side[] = longAxisIsX ? ["north", "south"] : ["west", "east"];
  const wall = longWalls.find((side) => side !== trackWall) ?? "north";
  const across = inset === undefined ? 0 : offCenter(frame, wall, inset, size.z);
  const longHalf = longAxisIsX ? interior.halfWidth : interior.halfDepth;
  const facing = oppositeSide[wall];
  return centeredOffsets(2 * longHalf - 2 * cornerReachStuds, spacing).map((along) =>
    longAxisIsX ? { x: along, z: across, facing } : { x: across, z: along, facing },
  );
}

type PieceSize = SetPieceRecord["size"];

function slotsOf(
  frame: RoomFrame,
  arrangement: Arrangement,
  size: PieceSize,
  trackWall: Side | undefined,
): Slot[] {
  switch (arrangement.shape) {
    case "grid":
      return gridSlots(frame, arrangement.spacing);
    case "rows":
      return rowSlots(frame, size, arrangement.spacing, arrangement.perRow);
    case "along-walls":
      return wallSlots(frame, size, arrangement.spacing, arrangement.walls, arrangement.inset);
    case "along-length":
      return lengthSlots(frame, size, arrangement.spacing, arrangement.inset, trackWall);
  }
}

function insideRoom({ room, interior }: RoomFrame, box: Box): boolean {
  return (
    box.minX >= room.x - interior.halfWidth &&
    box.maxX <= room.x + interior.halfWidth &&
    box.minZ >= room.z - interior.halfDepth &&
    box.maxZ <= room.z + interior.halfDepth
  );
}

/**
 * Places one arrangement's pieces in slot order, adding each piece's box to `blocked`. Each slot draws its
 * piece's seed from the room's `random`, so a row of one generator does not come out identical.
 */
function placeArrangement(
  frame: RoomFrame,
  arrangement: Arrangement,
  roomPieces: SetPieceRecord[],
  blocked: Box[],
  random: () => number,
): SetPieceRecord[] {
  const { room, interior } = frame;
  if (!isPropKind(arrangement.piece)) {
    throw new Error(
      `Room "${room.name}" arranges "${arrangement.piece}", which has no generator; use one of ${propKinds.join(", ")}.`,
    );
  }
  const size = propSize(arrangement.piece, interior.wallHeight);
  const longWalls: Side[] =
    interior.halfWidth >= interior.halfDepth ? ["north", "south"] : ["west", "east"];
  const trackWall = trackWallOf(frame, roomPieces, longWalls);
  const pieces: SetPieceRecord[] = [];
  for (const slot of slotsOf(frame, arrangement, size, trackWall)) {
    if (pieces.length >= (arrangement.max ?? Infinity)) {
      break;
    }
    const piece: SetPieceRecord = {
      kind: arrangement.piece,
      pivot: { x: room.x + slot.x, y: size.y / 2, z: room.z + slot.z },
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
  const frame = { room, interior: roomBounds(spec, room) };
  const roomPieces = setPieces.filter(
    (piece) =>
      Math.abs(piece.pivot.x - room.x) <= room.width / 2 &&
      Math.abs(piece.pivot.z - room.z) <= room.depth / 2,
  );
  const blocked = [...keepOutBoxes(frame), ...roomPieces.map(footprintOf)];
  const pieces: SetPieceRecord[] = [];
  const warnings: string[] = [];
  for (const arrangement of arrangements) {
    const placed = placeArrangement(frame, arrangement, roomPieces, blocked, random);
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
 * `along-walls` and `along-length` slots whose count grows with the room's floor. A slot is dropped when it
 * would leave the room or overlap a corner pillar, a doorway strip, a door's lane to the room center, a spawn
 * pad, a set piece or an earlier piece; an arrangement that places nothing adds one warning. Rooms without a
 * type or without arrangements get none, and an arranged piece with no generator throws. Each piece gets its
 * own seed from its room's random stream, so the same spec and seed give the same layout.
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
