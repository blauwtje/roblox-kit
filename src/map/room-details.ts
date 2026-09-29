import { config } from "../config.ts";
import type { Preset } from "../style/preset-schema.ts";
import type { PartRecord } from "./map-layout.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";

type Side = RoomSpec["doors"][number]["side"];

/** The preset surfaces the details are painted from. */
export type DetailSurfaces = Pick<Preset["surfaces"], "trim" | "accent">;

/**
 * One decorative axis-aligned part. It never collides, fires touch events or answers spatial queries,
 * so it cannot block a player or change what `check_map` measures.
 */
export interface DetailPart extends Omit<PartRecord, "kind" | "role"> {
  kind: "trim" | "stripe" | "pillar" | "arch";
  role: "trim" | "accent";
  canCollide: false;
  canTouch: false;
  canQuery: false;
}

/**
 * Sizes of the details, in studs, until they move to `config` (kept here because this task edits no other file).
 * Heights are measured from the floor or fractions of the wall height.
 */
export const detailDimensions = Object.freeze({
  /** Baseboard and crown: height and how far they stand out from the wall. */
  trimHeightStuds: 0.5,
  trimDepthStuds: 0.3,
  /** The accent stripe: height, depth, and the center's height as a fraction of the wall height. */
  stripeHeightStuds: 0.5,
  stripeDepthStuds: 0.15,
  stripeHeightFraction: 0.4,
  /** Corner pillars are square columns; a room too small to leave 4 pillar widths free gets none. */
  pillarSizeStuds: 1.5,
  /** Arch jambs beside a doorway and the lintel over it: jamb width, lintel height, depth from the wall. */
  archJambWidthStuds: 1,
  archLintelHeightStuds: 1.5,
  archDepthStuds: 0.6,
  /** How far a jamb reaches into the doorway, so its face is not coplanar with the baseboard end. */
  archLipStuds: 0.2,
});

interface RoomMeasure {
  wallHeight: number;
  wallThickness: number;
  doorWidth: number;
}

/** A band along the inner face of a wall stretch. */
interface Band {
  name: string;
  kind: "trim" | "stripe";
  role: "trim" | "accent";
  depth: number;
  height: number;
  centerHeight: number;
}

/** Room settings win over map settings, which win over the config defaults: the rule `layoutMap` uses. */
function measureRoom(spec: MapSpec, room: RoomSpec): RoomMeasure {
  return {
    wallHeight: room.wallHeight ?? spec.wallHeight ?? config.defaultWallHeightStuds,
    wallThickness: room.wallThickness ?? spec.wallThickness ?? config.defaultWallThicknessStuds,
    doorWidth: room.doorWidth ?? spec.doorWidth ?? config.defaultDoorWidthStuds,
  };
}

function isSide(text: string): text is Side {
  return text === "north" || text === "south" || text === "east" || text === "west";
}

/** The side and the number of a wall part named `<room><wallNameInfix><side>-<number>`. */
function wallLabel(wall: PartRecord): { side: Side; label: string } {
  const label = wall.name.slice(wall.room.length + config.wallNameInfix.length);
  const side = label.split("-")[0] ?? "";
  if (!wall.name.startsWith(`${wall.room}${config.wallNameInfix}`) || !isSide(side)) {
    throw new Error(
      `Wall part "${wall.name}" is not named "${wall.room}${config.wallNameInfix}<side>-<number>", so its side is unknown.`,
    );
  }
  return { side, label };
}

function decorativePart(
  fields: Pick<DetailPart, "name" | "room" | "kind" | "role" | "position" | "size">,
  surfaces: DetailSurfaces,
): DetailPart {
  const surface = surfaces[fields.role];
  return {
    ...fields,
    color: surface.color,
    material: surface.material,
    canCollide: false,
    canTouch: false,
    canQuery: false,
  };
}

/** Stands `along`/`across` (relative to the room center) and `height` on the axes of a wall running along X or along Z. */
function placeOnWall(
  room: RoomSpec,
  runsAlongX: boolean,
  along: number,
  across: number,
  height: number,
) {
  return {
    x: room.x + (runsAlongX ? along : across),
    y: height,
    z: room.z + (runsAlongX ? across : along),
  };
}

function wallSizeOf(runsAlongX: boolean, length: number, height: number, depth: number) {
  return { x: runsAlongX ? length : depth, y: height, z: runsAlongX ? depth : length };
}

/** Bands of the given wall stretch, clipped so bands of neighboring walls do not overlap at a corner. */
function bandParts(
  room: RoomSpec,
  measure: RoomMeasure,
  wall: PartRecord,
  surfaces: DetailSurfaces,
): DetailPart[] {
  const { side, label } = wallLabel(wall);
  const runsAlongX = side === "north" || side === "south";
  const towardCenter = side === "south" || side === "east" ? -1 : 1;
  const wallAlong = runsAlongX ? wall.position.x - room.x : wall.position.z - room.z;
  const wallAcross = runsAlongX ? wall.position.z - room.z : wall.position.x - room.x;
  const halfLength = (runsAlongX ? wall.size.x : wall.size.z) / 2;
  const { wallHeight, wallThickness } = measure;
  const bands: Band[] = [
    {
      name: "baseboard",
      kind: "trim",
      role: "trim",
      depth: detailDimensions.trimDepthStuds,
      height: detailDimensions.trimHeightStuds,
      centerHeight: detailDimensions.trimHeightStuds / 2,
    },
    {
      name: "crown",
      kind: "trim",
      role: "trim",
      depth: detailDimensions.trimDepthStuds,
      height: detailDimensions.trimHeightStuds,
      centerHeight: wallHeight - detailDimensions.trimHeightStuds / 2,
    },
    {
      name: "stripe",
      kind: "stripe",
      role: "accent",
      depth: detailDimensions.stripeDepthStuds,
      height: detailDimensions.stripeHeightStuds,
      centerHeight: wallHeight * detailDimensions.stripeHeightFraction,
    },
  ];
  const parts: DetailPart[] = [];
  for (const band of bands) {
    // North and south bands reach the side walls; east and west bands stop at the north and south bands.
    const reach = (runsAlongX ? room.width : room.depth) / 2 - wallThickness;
    const limit = runsAlongX ? reach : reach - band.depth;
    const start = Math.max(wallAlong - halfLength, -limit);
    const end = Math.min(wallAlong + halfLength, limit);
    if (end > start) {
      parts.push(
        decorativePart(
          {
            name: `${room.name}-${band.name}-${label}`,
            room: room.name,
            kind: band.kind,
            role: band.role,
            position: placeOnWall(
              room,
              runsAlongX,
              (start + end) / 2,
              wallAcross + towardCenter * (wallThickness / 2 + band.depth / 2),
              band.centerHeight,
            ),
            size: wallSizeOf(runsAlongX, end - start, band.height, band.depth),
          },
          surfaces,
        ),
      );
    }
  }
  return parts;
}

interface Corner {
  name: string;
  /** -1 for the north or west corner, 1 for the south or east one. */
  signX: -1 | 1;
  signZ: -1 | 1;
}

const corners: Corner[] = [
  { name: "northwest", signX: -1, signZ: -1 },
  { name: "northeast", signX: 1, signZ: -1 },
  { name: "southwest", signX: -1, signZ: 1 },
  { name: "southeast", signX: 1, signZ: 1 },
];

/** How far along a wall a doorway's arch reaches on each side of the door center. */
function archReach(measure: RoomMeasure): number {
  return (
    measure.doorWidth / 2 + detailDimensions.archJambWidthStuds - detailDimensions.archLipStuds
  );
}

/** Whether a door on a wall of the pillar's corner has its arch over the pillar's footprint. */
function doorReachesCorner(room: RoomSpec, measure: RoomMeasure, corner: Corner): boolean {
  const pillarSize = detailDimensions.pillarSizeStuds;
  const reach = archReach(measure);
  return room.doors.some((door) => {
    const isNorthSouthDoor = door.side === "north" || door.side === "south";
    const sideSign = door.side === "south" || door.side === "east" ? 1 : -1;
    if (sideSign !== (isNorthSouthDoor ? corner.signZ : corner.signX)) {
      return false;
    }
    const halfSpan = (isNorthSouthDoor ? room.width : room.depth) / 2 - measure.wallThickness;
    const cornerSign = isNorthSouthDoor ? corner.signX : corner.signZ;
    const pillarCenter = cornerSign * (halfSpan - pillarSize / 2);
    return Math.abs(door.offset - pillarCenter) < reach + pillarSize / 2;
  });
}

function pillarParts(room: RoomSpec, measure: RoomMeasure, surfaces: DetailSurfaces): DetailPart[] {
  const pillarSize = detailDimensions.pillarSizeStuds;
  const halfWidth = room.width / 2 - measure.wallThickness;
  const halfDepth = room.depth / 2 - measure.wallThickness;
  if (halfWidth < 2 * pillarSize || halfDepth < 2 * pillarSize) {
    return [];
  }
  return corners
    .filter((corner) => !doorReachesCorner(room, measure, corner))
    .map((corner) =>
      decorativePart(
        {
          name: `${room.name}-pillar-${corner.name}`,
          room: room.name,
          kind: "pillar",
          role: "trim",
          position: {
            x: room.x + corner.signX * (halfWidth - pillarSize / 2),
            y: measure.wallHeight / 2,
            z: room.z + corner.signZ * (halfDepth - pillarSize / 2),
          },
          size: { x: pillarSize, y: measure.wallHeight, z: pillarSize },
        },
        surfaces,
      ),
    );
}

/** Two jambs on the inner wall face beside a doorway and a lintel across its top. */
function archParts(
  room: RoomSpec,
  measure: RoomMeasure,
  door: RoomSpec["doors"][number],
  doorNumber: number,
  surfaces: DetailSurfaces,
): DetailPart[] {
  const { archJambWidthStuds, archLintelHeightStuds, archDepthStuds, archLipStuds } =
    detailDimensions;
  const runsAlongX = door.side === "north" || door.side === "south";
  const towardCenter = door.side === "south" || door.side === "east" ? -1 : 1;
  const wallSign = -towardCenter;
  const wallAcross =
    wallSign * ((runsAlongX ? room.depth : room.width) / 2 - measure.wallThickness / 2);
  const across = wallAcross + towardCenter * (measure.wallThickness / 2 + archDepthStuds / 2);
  const jambOffset = measure.doorWidth / 2 - archLipStuds + archJambWidthStuds / 2;
  const jambs = [-1, 1].map((jambSign) => ({
    piece: jambSign < 0 ? "left" : "right",
    along: door.offset + jambSign * jambOffset,
    length: archJambWidthStuds,
    height: measure.wallHeight,
    centerHeight: measure.wallHeight / 2,
  }));
  const lintel = {
    piece: "lintel",
    along: door.offset,
    length: measure.doorWidth - 2 * archLipStuds,
    height: archLintelHeightStuds,
    centerHeight: measure.wallHeight - archLintelHeightStuds / 2,
  };
  return [...jambs, lintel].map((piece) =>
    decorativePart(
      {
        name: `${room.name}-arch-${String(doorNumber)}-${piece.piece}`,
        room: room.name,
        kind: "arch",
        role: "trim",
        position: placeOnWall(room, runsAlongX, piece.along, across, piece.centerHeight),
        size: wallSizeOf(runsAlongX, piece.length, piece.height, archDepthStuds),
      },
      surfaces,
    ),
  );
}

/**
 * Baseboards, crowns, accent stripes, corner pillars and doorway arches for every room of a laid-out map,
 * painted from the preset's trim and accent surfaces. Deterministic: the same inputs give the same parts.
 * `parts` are the parts `layoutMap` returned for `spec`.
 */
export function buildRoomDetails(
  spec: MapSpec,
  parts: PartRecord[],
  surfaces: DetailSurfaces,
): DetailPart[] {
  const details: DetailPart[] = [];
  for (const room of spec.rooms) {
    const measure = measureRoom(spec, room);
    const walls = parts.filter((part) => part.kind === "wall" && part.room === room.name);
    for (const wall of walls) {
      details.push(...bandParts(room, measure, wall, surfaces));
    }
    details.push(...pillarParts(room, measure, surfaces));
    for (const [doorIndex, door] of room.doors.entries()) {
      details.push(...archParts(room, measure, door, doorIndex + 1, surfaces));
    }
  }
  return details;
}
