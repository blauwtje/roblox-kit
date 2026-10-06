import { config } from "../config.ts";
import type { Vector } from "../map/map-layout.ts";
import type { MapSpec, RoomSpec } from "../map/map-spec.ts";
import { cornerReachStuds, roomBounds } from "../map/prop-placement.ts";
import type { RoomBounds } from "../map/prop-placement.ts";
import type { Preset } from "../style/preset-schema.ts";
import { progressionFactor, progressionScale, roomProgression } from "../style/resolve-style.ts";

export type LightRoleName = keyof Preset["lightRoles"];

type LightFixtures = NonNullable<Preset["lightFixtures"]>;
type WallSide = RoomSpec["doors"][number]["side"];

/** The box of a visible fixture that holds its light, centered at `position`. */
export interface FixtureBox {
  position: Vector;
  size: Vector;
}

/** One light to create: its zone, role, where it hangs, its range, that it casts no shadow and the fixture that holds it. */
export interface LightPlacement {
  /** Name of the room the light belongs to. */
  zone: string;
  role: LightRoleName;
  position: Vector;
  range: number;
  /** Always false: a PointLight shadow costs a cube-map render per frame, too much for mobile. */
  shadows: false;
  /** Set on a light a preset's `lightFixtures` places; the center and focal lights have none. */
  fixture?: FixtureBox;
}

/** The room with the largest floor area; the first one wins a tie. */
function largestRoom(rooms: RoomSpec[]): RoomSpec | undefined {
  let largest: RoomSpec | undefined;
  for (const room of rooms) {
    if (largest === undefined || room.width * room.depth > largest.width * largest.depth) {
      largest = room;
    }
  }
  return largest;
}

/** Positions `spacing` studs apart, centered on 0, within `-limit` to `limit`; none when `limit` is negative. */
function repeatedOffsets(limit: number, spacing: number): number[] {
  if (limit < 0) {
    return [];
  }
  const count = Math.max(1, Math.floor((2 * limit) / spacing) + 1);
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * spacing);
}

/** Whether a fixture `along` a wall, reaching `halfExtent` either side, would cover a door gap of the wall. */
function blocksDoor(
  room: RoomSpec,
  side: WallSide,
  doorWidth: number,
  along: number,
  halfExtent: number,
) {
  return room.doors.some(
    (door) => door.side === side && Math.abs(along - door.offset) < doorWidth / 2 + halfExtent,
  );
}

/** The sconces of one room: along each wall, clear of the corner pillars and of every door gap. */
function sconceBoxes(
  room: RoomSpec,
  bounds: RoomBounds,
  fixtures: Extract<LightFixtures, { kind: "sconce" }>,
): FixtureBox[] {
  const { width, height, depth } = fixtures.size;
  const boxes: FixtureBox[] = [];
  for (const side of ["north", "south", "east", "west"] as const) {
    const alongX = side === "north" || side === "south";
    const halfAlongWall = alongX ? bounds.halfWidth : bounds.halfDepth;
    const wallFace = alongX ? bounds.halfDepth : bounds.halfWidth;
    const sign = side === "south" || side === "east" ? 1 : -1;
    const offsets = repeatedOffsets(halfAlongWall - cornerReachStuds - width / 2, fixtures.spacing);
    for (const along of offsets) {
      if (blocksDoor(room, side, bounds.doorWidth, along, width / 2)) {
        continue;
      }
      const inward = sign * (wallFace - depth / 2);
      boxes.push({
        position: {
          x: room.x + (alongX ? along : inward),
          y: fixtures.height,
          z: room.z + (alongX ? inward : along),
        },
        size: { x: alongX ? width : depth, y: height, z: alongX ? depth : width },
      });
    }
  }
  return boxes;
}

/**
 * The pendants of one room, each hanging `drop` studs below the ceiling: a grid centered on the
 * room, or with `lines` that many lines along the long axis, `spacing` apart and centered across
 * the short one. A line that would leave the room is dropped.
 */
function pendantBoxes(
  room: RoomSpec,
  bounds: RoomBounds,
  fixtures: Extract<LightFixtures, { kind: "pendant" }>,
): FixtureBox[] {
  const { width, height, depth } = fixtures.size;
  const halfWidth = Math.max(0, bounds.halfWidth - width / 2);
  const halfDepth = Math.max(0, bounds.halfDepth - depth / 2);
  let columns = repeatedOffsets(halfWidth, fixtures.spacing);
  let rows = repeatedOffsets(halfDepth, fixtures.spacing);
  if (fixtures.lines !== undefined) {
    const lineCount = fixtures.lines;
    const lineOffsets = Array.from(
      { length: lineCount },
      (_, index) => (index - (lineCount - 1) / 2) * fixtures.spacing,
    );
    if (bounds.halfWidth >= bounds.halfDepth) {
      rows = lineOffsets.filter((offset) => Math.abs(offset) <= halfDepth);
    } else {
      columns = lineOffsets.filter((offset) => Math.abs(offset) <= halfWidth);
    }
  }
  return columns.flatMap((column) =>
    rows.map((row) => ({
      position: { x: room.x + column, y: bounds.wallHeight - fixtures.drop, z: room.z + row },
      size: { x: width, y: height, z: depth },
    })),
  );
}

function fixtureBoxes(spec: MapSpec, room: RoomSpec, fixtures: LightFixtures): FixtureBox[] {
  const bounds = roomBounds(spec, room);
  return fixtures.kind === "sconce"
    ? sconceBoxes(room, bounds, fixtures)
    : pendantBoxes(room, bounds, fixtures);
}

/**
 * Places the lights of a map from a style's light roles. Without `lightFixtures`, every room gets
 * one light at its center below the ceiling: the hero in the largest room and a zone marker in each
 * other room. With them, every room's center light is a hero and the fixtures repeat as zone
 * markers, each holding its light. A room with a spawn pad gets a focal light over the pad. No
 * light casts shadows, and a room keeps at most `config.maxLocalLightsPerRoom` lights, the
 * latest placed dropped first. Every light's range shrinks with the room's depth from the spawn
 * room (`roomProgression`), to `progressionScale.lightRange` of its role's range.
 */
export function placeLights(
  spec: MapSpec,
  lightRoles: Preset["lightRoles"],
  lightFixtures?: Preset["lightFixtures"],
): LightPlacement[] {
  const heroRoom = largestRoom(spec.rooms);
  const progression = roomProgression(spec);
  const placements: LightPlacement[] = [];
  for (const room of spec.rooms) {
    const roomStart = placements.length;
    // Rooms deeper from the spawn room get a shorter reach, which reads as dimmer light.
    const reach = progressionFactor(progression.get(room.name) ?? 0, progressionScale.lightRange);
    const wallHeight = room.wallHeight ?? spec.wallHeight ?? config.defaultWallHeightStuds;
    const isHeroRoom = lightFixtures !== undefined || room === heroRoom;
    const role = isHeroRoom ? "hero" : "zoneMarker";
    placements.push({
      zone: room.name,
      role,
      position: { x: room.x, y: wallHeight - config.lightCeilingDropStuds, z: room.z },
      range: lightRoles[role].range * reach,
      shadows: false,
    });
    if (lightFixtures !== undefined) {
      for (const fixture of fixtureBoxes(spec, room, lightFixtures)) {
        placements.push({
          zone: room.name,
          role: "zoneMarker",
          position: fixture.position,
          range: lightRoles.zoneMarker.range * reach,
          shadows: false,
          fixture,
        });
      }
    }
    if (room.spawn) {
      placements.push({
        zone: room.name,
        role: "focal",
        position: { x: room.x, y: config.focalLightHeightStuds, z: room.z },
        range: lightRoles.focal.range * reach,
        shadows: false,
      });
    }
    placements.length = Math.min(placements.length, roomStart + config.maxLocalLightsPerRoom);
  }
  return placements;
}
