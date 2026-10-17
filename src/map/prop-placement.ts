import { config } from "../config.ts";
import { createSeededRandom } from "../shared/seeded-random.ts";
import { detailDimensions } from "./room-details.ts";
import { measureRoom } from "./map-spec.ts";
import type { MapSpec, RoomSpec, Side } from "./map-spec.ts";
import type { Vector } from "./map-layout.ts";
import { pointOnWall, rotatedHalfExtents, runsAlongX, sideOrder, wallBox } from "./room-frame.ts";
import type { RoomFrame } from "./room-frame.ts";

/** The generator kinds that have a source in `luau/props/`; a preset's prop kit names some of them. */
export const propKinds = [
  "bench",
  "lamp",
  "pillar",
  "stairs",
  "rail",
  "track-bed",
  "platform-edge",
  "counter",
  "sign",
  "lab-bench",
  "cell-bars",
  "control-console",
  "crate-stack",
  "fireplace",
  "departure-board",
  "clock",
  "ticket-counter",
  "ticket-machine",
  "bin",
  "luggage",
  "potted-plant",
  "newspaper-stack",
  "poster",
] as const;

export type PropKind = (typeof propKinds)[number];

/** One prop to generate: `pivot` is its center in studs and `size` the box the generator fills. */
export interface PropRecord {
  kind: PropKind;
  pivot: Vector;
  size: Vector;
  /** Degrees about Y that turn the prop's -Z front toward the room; absent means 0. */
  yaw?: number;
  /** The generator's `Seed` attribute. */
  seed: number;
}

/** A length rounded to hundredths of a stud, so anchored heights carry no float noise. */
function roundStuds(value: number): number {
  return Math.round(value * 100) / 100;
}

const { character, propAnchors } = config;
const counterTopStuds = roundStuds(character.heightStuds * propAnchors.counterTopRatio);

/** A height that is `ratio` of the rig. */
function ofCharacter(ratio: number): number {
  return roundStuds(character.heightStuds * ratio);
}

/** A height that reaches `riseStuds` above the rig's eyes. */
function aboveEye(riseStuds: number): number {
  return roundStuds(character.eyeHeightStuds + riseStuds);
}

/** Width of a pillar in a wall of the given height. */
export function pillarWidth(wallHeight: number): number {
  return roundStuds(wallHeight * config.pillarWidthToWallHeightRatio);
}

/**
 * Sizes and spacing of the props, in studs. Heights derive from the R15 anchors in `config.character` and `config.propAnchors`.
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
  bench: { x: 6, y: propAnchors.seatHeightStuds + propAnchors.backrestRiseStuds, z: 2.5 },
  lamp: { x: 1.5, y: ofCharacter(propAnchors.lampHeightRatio), z: 1.5 },
  /** The pillar's height is its wall's, so only its width at the default wall height is listed. */
  pillar: {
    x: pillarWidth(config.defaultWallHeightStuds),
    z: pillarWidth(config.defaultWallHeightStuds),
  },
  stairs: { x: 6, y: propAnchors.stairsRiseStuds, z: 4 },
  rail: { x: 8, y: propAnchors.railHeightStuds, z: 0.5 },
  "track-bed": { x: 16, y: propAnchors.trackBedHeightStuds, z: 5 },
  "platform-edge": { x: 16, y: propAnchors.platformEdgeHeightStuds, z: 2 },
  counter: { x: 8, y: counterTopStuds, z: 2.5 },
  sign: { x: 8, y: propAnchors.signHeightStuds, z: 0.4 },
  "lab-bench": { x: 7, y: roundStuds(counterTopStuds + propAnchors.labBenchTopRiseStuds), z: 2.5 },
  "cell-bars": { x: 8, y: ofCharacter(propAnchors.cellBarsHeightRatio), z: 0.5 },
  "control-console": {
    x: 6,
    y: roundStuds(counterTopStuds + propAnchors.consoleTopRiseStuds),
    z: 3.5,
  },
  "crate-stack": { x: 4, y: ofCharacter(propAnchors.crateStackHeightRatio), z: 2.5 },
  fireplace: { x: 6, y: ofCharacter(propAnchors.fireplaceHeightRatio), z: 2 },
  "departure-board": { x: 12, y: aboveEye(propAnchors.departureBoardAboveEyeStuds), z: 1 },
  clock: { x: 5, y: aboveEye(propAnchors.clockAboveEyeStuds), z: 1.2 },
  "ticket-counter": { x: 14, y: aboveEye(propAnchors.ticketCounterAboveEyeStuds), z: 3 },
  "ticket-machine": { x: 3, y: aboveEye(propAnchors.ticketMachineAboveEyeStuds), z: 2 },
  bin: { x: 1.5, y: 2, z: 1.5 },
  luggage: { x: 2.5, y: 1.5, z: 1 },
  "potted-plant": { x: 1.5, y: 3, z: 1.5 },
  "newspaper-stack": { x: 1.5, y: 0.6, z: 1 },
  poster: { x: 3, y: 4, z: 0.2 },
});

/** The yaw that turns a piece's -Z face toward each side of the room. */
export const yawFacing: Record<Side, number> = { north: 0, west: 90, south: 180, east: 270 };

export const oppositeSide: Record<Side, Side> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

/** A rectangle on the floor plane, in coordinates relative to the room center. */
export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoomBounds {
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

/** The seed of a placement and the optional preset weights that steer it. */
export interface PlaceRun {
  seed: number;
  weights?: Record<string, PropWeight>;
}

/** A preset's pick weight for a prop kind and the walls it may stand against. */
export interface PropWeight {
  weight: number;
  wall: "any" | "long" | "doorless";
}

interface WeightedKit {
  kinds: PropKind[];
  weights?: Record<string, PropWeight>;
}

function pickKind(kit: WeightedKit, random: () => number): PropKind {
  const { weights } = kit;
  if (weights === undefined) {
    return pickFrom(kit.kinds, random);
  }
  const weightOf = (kind: PropKind): number => weights[kind]?.weight ?? 1;
  let remaining = random() * kit.kinds.reduce((sum, kind) => sum + weightOf(kind), 0);
  const picked = kit.kinds.find((kind) => {
    remaining -= weightOf(kind);
    return remaining < 0;
  });
  return picked ?? pickFrom(kit.kinds, random);
}

function wallsFor(kind: PropKind, room: RoomSpec, kit: WeightedKit): readonly Side[] {
  const wall = kit.weights?.[kind]?.wall ?? "any";
  const allowed = sideOrder.filter((side) => {
    if (wall === "long") {
      return room.width === room.depth || runsAlongX(side) === room.width > room.depth;
    }
    return wall === "any" || !room.doors.some((door) => door.side === side);
  });
  return allowed.length > 0 ? allowed : sideOrder;
}

export function isPropKind(name: string): name is PropKind {
  return (propKinds as readonly string[]).includes(name);
}

/** Size of a prop along a north or south wall; the lamp and pillar are capped by, or as tall as, the wall. */
export function propSize(kind: PropKind, wallHeight: number): Vector {
  if (kind === "pillar") {
    const width = pillarWidth(wallHeight);
    return { x: width, y: wallHeight, z: width };
  }
  const size = propDimensions[kind];
  return { ...size, y: Math.min(size.y, wallHeight) };
}

export function roomBounds(spec: MapSpec, room: RoomSpec): RoomBounds {
  const { wallThickness, wallHeight, doorWidth } = measureRoom(spec, room);
  return {
    halfWidth: room.width / 2 - wallThickness,
    halfDepth: room.depth / 2 - wallThickness,
    wallHeight,
    doorWidth,
  };
}

function originFrame(bounds: RoomBounds): RoomFrame {
  return { x: 0, z: 0, wallThickness: 0, ...bounds };
}

/** How far a corner pillar reaches along a wall, kept free at each corner. */
export const cornerReachStuds = detailDimensions.pillarSizeStuds + propDimensions.clearanceStuds;

/** The four corners kept free for the corner pillars of `buildRoomDetails`. */
export function cornerFootprints(bounds: RoomBounds): Footprint[] {
  const reach = cornerReachStuds;
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
export function doorwayFootprint(bounds: RoomBounds, door: RoomSpec["doors"][number]): Footprint {
  const halfOpening = bounds.doorWidth / 2 + propDimensions.clearanceStuds;
  return wallBox(originFrame(bounds), door.side, {
    alongMin: door.offset - halfOpening,
    alongMax: door.offset + halfOpening,
    depth: propDimensions.doorwayDepthStuds,
  });
}

export function overlaps(first: Footprint, second: Footprint): boolean {
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
  const { halfX, halfZ } = rotatedHalfExtents(size, runsAlongX(side) ? 0 : 90);
  const inset = propDimensions.clearanceStuds + (runsAlongX(side) ? halfZ : halfX);
  const center = pointOnWall(originFrame(bounds), side, { along, inset });
  return {
    minX: center.x - halfX,
    maxX: center.x + halfX,
    minZ: center.z - halfZ,
    maxZ: center.z + halfZ,
  };
}

/** Props of one room: each is tried at random spots along the walls and dropped when none is free. */
function roomProps(
  spec: MapSpec,
  room: RoomSpec,
  kit: WeightedKit,
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
    const kind = pickKind(kit, random);
    const walls = wallsFor(kind, room, kit);
    const size = propSize(kind, bounds.wallHeight);
    const propSeed = Math.floor(random() * 2 ** 31);
    for (let attempt = 0; attempt < propDimensions.attemptsPerProp; attempt += 1) {
      const side = pickFrom(walls, random);
      const wallHalfSpan = runsAlongX(side) ? bounds.halfWidth : bounds.halfDepth;
      const reach = wallHalfSpan - size.x / 2;
      const along = (random() * 2 - 1) * reach;
      const footprint = footprintAgainst(bounds, side, along, size);
      const blocked = reserved.some((taken) =>
        overlaps(grown(footprint, propDimensions.clearanceStuds / 2), taken),
      );
      if (reach > 0 && !blocked) {
        reserved.push(footprint);
        props.push({
          kind,
          pivot: {
            x: room.x + (footprint.minX + footprint.maxX) / 2,
            y: size.y / 2,
            z: room.z + (footprint.minZ + footprint.maxZ) / 2,
          },
          size,
          yaw: yawFacing[oppositeSide[side]],
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
 * `run` is the seed, or the seed with a preset's `propWeights`, which bias the kind pick and limit the walls a kind uses; absent keeps the uniform pick.
 */
export function placeProps(spec: MapSpec, propKit: string[], run: number | PlaceRun): PropRecord[] {
  const { seed, weights } = typeof run === "number" ? { seed: run, weights: undefined } : run;
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
      { kinds, weights },
      createSeededRandom(seed + roomIndex * propDimensions.roomSeedStride),
    ),
  );
}
