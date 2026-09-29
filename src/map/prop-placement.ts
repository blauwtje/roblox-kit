import { config } from "../config.ts";
import { createSeededRandom } from "../shared/seeded-random.ts";
import { detailDimensions } from "./room-details.ts";
import type { MapSpec, RoomSpec } from "./map-spec.ts";
import type { Vector } from "./map-layout.ts";

type Side = RoomSpec["doors"][number]["side"];

/** The generator kinds that have a source in `luau/props/`; a preset's prop kit names some of them. */
export const propKinds = ["bench", "lamp", "pillar", "stairs", "rail"] as const;

export type PropKind = (typeof propKinds)[number];

/** One prop to generate: `pivot` is its center in studs and `size` the box the generator fills. */
export interface PropRecord {
  kind: PropKind;
  pivot: Vector;
  size: Vector;
  /** The generator's `Seed` attribute. */
  seed: number;
}

/**
 * Sizes and spacing of the props, in studs, until they move to `config` (kept here because this task edits no other file).
 * Sizes are for a footprint along a north or south wall: x runs along the wall, z away from it.
 */
export const propDimensions = Object.freeze({
  /** Room floor area (inner) per prop, and the most props one room gets. */
  floorAreaPerPropSquareStuds: 220,
  maxPropsPerRoom: 6,
  /** Free space kept between a prop and a wall face, another prop, a corner pillar or a doorway. */
  clearanceStuds: 1,
  /** How far into the room a doorway is kept free. */
  doorwayDepthStuds: 8,
  /** Distance between the seeds of two rooms' random streams, so neighbouring rooms differ. */
  roomSeedStride: 7919,
  /** Tries to find a free spot for one prop before it is dropped. */
  attemptsPerProp: 12,
  bench: { x: 6, y: 3, z: 2.5 },
  lamp: { x: 1.5, y: 9, z: 1.5 },
  pillar: { x: 1.5, z: 1.5 },
  stairs: { x: 6, y: 3, z: 4 },
  rail: { x: 8, y: 3, z: 0.5 },
});

const sides: Side[] = ["north", "south", "east", "west"];

/** A rectangle on the floor plane, in coordinates relative to the room center. */
interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface RoomBounds {
  halfWidth: number;
  halfDepth: number;
  wallHeight: number;
  doorWidth: number;
}

/** A random item of a non-empty list. */
function pickFrom<Item>(items: readonly Item[], random: () => number): Item {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error("Cannot pick from an empty list.");
  }
  return item;
}

function isPropKind(name: string): name is PropKind {
  return (propKinds as readonly string[]).includes(name);
}

/** Size of a prop along a north or south wall; the lamp and pillar are capped by, or as tall as, the wall. */
function propSize(kind: PropKind, wallHeight: number): Vector {
  if (kind === "pillar") {
    return { ...propDimensions.pillar, y: wallHeight };
  }
  const size = propDimensions[kind];
  return { ...size, y: Math.min(size.y, wallHeight) };
}

function roomBounds(spec: MapSpec, room: RoomSpec): RoomBounds {
  const wallThickness =
    room.wallThickness ?? spec.wallThickness ?? config.defaultWallThicknessStuds;
  return {
    halfWidth: room.width / 2 - wallThickness,
    halfDepth: room.depth / 2 - wallThickness,
    wallHeight: room.wallHeight ?? spec.wallHeight ?? config.defaultWallHeightStuds,
    doorWidth: room.doorWidth ?? spec.doorWidth ?? config.defaultDoorWidthStuds,
  };
}

/** The four corners kept free for the corner pillars of `buildRoomDetails`. */
function cornerFootprints(bounds: RoomBounds): Footprint[] {
  const reach = detailDimensions.pillarSizeStuds + propDimensions.clearanceStuds;
  return [-1, 1].flatMap((signX) =>
    [-1, 1].map((signZ) => ({
      minX: signX < 0 ? -bounds.halfWidth : bounds.halfWidth - reach,
      maxX: signX < 0 ? -bounds.halfWidth + reach : bounds.halfWidth,
      minZ: signZ < 0 ? -bounds.halfDepth : bounds.halfDepth - reach,
      maxZ: signZ < 0 ? -bounds.halfDepth + reach : bounds.halfDepth,
    })),
  );
}

/** The strip in front of a doorway that props keep free. */
function doorwayFootprint(bounds: RoomBounds, door: RoomSpec["doors"][number]): Footprint {
  const halfOpening = bounds.doorWidth / 2 + propDimensions.clearanceStuds;
  const depth = propDimensions.doorwayDepthStuds;
  const alongMin = door.offset - halfOpening;
  const alongMax = door.offset + halfOpening;
  switch (door.side) {
    case "north":
      return {
        minX: alongMin,
        maxX: alongMax,
        minZ: -bounds.halfDepth,
        maxZ: -bounds.halfDepth + depth,
      };
    case "south":
      return {
        minX: alongMin,
        maxX: alongMax,
        minZ: bounds.halfDepth - depth,
        maxZ: bounds.halfDepth,
      };
    case "east":
      return {
        minX: bounds.halfWidth - depth,
        maxX: bounds.halfWidth,
        minZ: alongMin,
        maxZ: alongMax,
      };
    case "west":
      return {
        minX: -bounds.halfWidth,
        maxX: -bounds.halfWidth + depth,
        minZ: alongMin,
        maxZ: alongMax,
      };
  }
}

function overlaps(first: Footprint, second: Footprint): boolean {
  return (
    first.minX < second.maxX &&
    first.maxX > second.minX &&
    first.minZ < second.maxZ &&
    first.maxZ > second.minZ
  );
}

function grown(footprint: Footprint, margin: number): Footprint {
  return {
    minX: footprint.minX - margin,
    maxX: footprint.maxX + margin,
    minZ: footprint.minZ - margin,
    maxZ: footprint.maxZ + margin,
  };
}

/** The footprint of a prop of `size` against `side`, `along` the wall from the room center. */
function footprintAgainst(bounds: RoomBounds, side: Side, along: number, size: Vector): Footprint {
  const gap = propDimensions.clearanceStuds;
  const runsAlongX = side === "north" || side === "south";
  const halfX = (runsAlongX ? size.x : size.z) / 2;
  const halfZ = (runsAlongX ? size.z : size.x) / 2;
  if (runsAlongX) {
    const centerZ =
      side === "north" ? -bounds.halfDepth + gap + halfZ : bounds.halfDepth - gap - halfZ;
    return {
      minX: along - halfX,
      maxX: along + halfX,
      minZ: centerZ - halfZ,
      maxZ: centerZ + halfZ,
    };
  }
  const centerX =
    side === "west" ? -bounds.halfWidth + gap + halfX : bounds.halfWidth - gap - halfX;
  return { minX: centerX - halfX, maxX: centerX + halfX, minZ: along - halfZ, maxZ: along + halfZ };
}

/** Props of one room: each is tried at random spots along the walls and dropped when none is free. */
function roomProps(
  spec: MapSpec,
  room: RoomSpec,
  propKit: PropKind[],
  random: () => number,
): PropRecord[] {
  const bounds = roomBounds(spec, room);
  const floorArea = 4 * bounds.halfWidth * bounds.halfDepth;
  const wantedCount = Math.min(
    propDimensions.maxPropsPerRoom,
    Math.floor(floorArea / propDimensions.floorAreaPerPropSquareStuds),
  );
  const reserved = [
    ...cornerFootprints(bounds),
    ...room.doors.map((door) => doorwayFootprint(bounds, door)),
  ];
  const props: PropRecord[] = [];
  for (let propNumber = 0; propNumber < wantedCount; propNumber += 1) {
    const kind = pickFrom(propKit, random);
    const size = propSize(kind, bounds.wallHeight);
    const propSeed = Math.floor(random() * 2 ** 31);
    for (let attempt = 0; attempt < propDimensions.attemptsPerProp; attempt += 1) {
      const side = pickFrom(sides, random);
      const runsAlongX = side === "north" || side === "south";
      const wallHalfSpan = runsAlongX ? bounds.halfWidth : bounds.halfDepth;
      const reach = wallHalfSpan - (runsAlongX ? size.x : size.z) / 2;
      const along = (random() * 2 - 1) * reach;
      const footprint = footprintAgainst(bounds, side, along, size);
      const blocked = reserved.some((taken) =>
        overlaps(grown(footprint, propDimensions.clearanceStuds / 2), taken),
      );
      if (reach > 0 && !blocked) {
        reserved.push(footprint);
        const worldSize = runsAlongX ? size : { x: size.z, y: size.y, z: size.x };
        props.push({
          kind,
          pivot: {
            x: room.x + (footprint.minX + footprint.maxX) / 2,
            y: size.y / 2,
            z: room.z + (footprint.minZ + footprint.maxZ) / 2,
          },
          size: worldSize,
          seed: propSeed,
        });
        break;
      }
    }
  }
  return props;
}

/**
 * Props from a preset's prop kit for every room of a placed map, standing against the walls and clear of
 * doorways, corner pillars and each other. Deterministic: the same spec, kit and seed give the same props.
 * Throws on a kit name with no generator, since the build would have nothing to run for it.
 */
export function placeProps(spec: MapSpec, propKit: string[], seed: number): PropRecord[] {
  const kinds = propKit.map((name) => {
    if (!isPropKind(name)) {
      throw new Error(
        `Prop kit entry "${name}" has no generator; use one of ${propKinds.join(", ")}.`,
      );
    }
    return name;
  });
  if (kinds.length === 0) {
    return [];
  }
  return spec.rooms.flatMap((room, roomIndex) =>
    roomProps(
      spec,
      room,
      kinds,
      createSeededRandom(seed + roomIndex * propDimensions.roomSeedStride),
    ),
  );
}
