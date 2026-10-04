import { config } from "../config.ts";
import type { Vector } from "../map/map-layout.ts";
import type { MapSpec, RoomSpec } from "../map/map-spec.ts";
import { cornerReachStuds, roomBounds } from "../map/prop-placement.ts";
import type { RoomBounds } from "../map/prop-placement.ts";
import type { Preset } from "../style/preset-schema.ts";

export type LightRoleName = keyof Preset["lightRoles"];

type LightFixtures = NonNullable<Preset["lightFixtures"]>;
type WallSide = RoomSpec["doors"][number]["side"];

/** The box of a visible fixture that holds its light, centered at `position`. */
export interface FixtureBox {
  position: Vector;
  size: Vector;
}

/** One light to create: its zone, role, where it hangs, its range, whether it casts shadows and the fixture that holds it. */
export interface LightPlacement {
  /** Name of the room the light belongs to. */
  zone: string;
  role: LightRoleName;
  position: Vector;
  range: number;
  shadows: boolean;
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

/** The pendants of one room: a grid centered on the room, each hanging `drop` studs below the ceiling. */
function pendantBoxes(
  room: RoomSpec,
  bounds: RoomBounds,
  fixtures: Extract<LightFixtures, { kind: "pendant" }>,
): FixtureBox[] {
  const { width, height, depth } = fixtures.size;
  const columns = repeatedOffsets(Math.max(0, bounds.halfWidth - width / 2), fixtures.spacing);
  const rows = repeatedOffsets(Math.max(0, bounds.halfDepth - depth / 2), fixtures.spacing);
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
 * one light at its center below the ceiling: the hero in the largest room, a zone marker in each
 * other room, and only the hero casts shadows. With them, every room's center light is a hero that
 * casts shadows and the fixtures repeat as shadowless zone markers, each holding its light. A room
 * with a spawn pad gets a focal light over the pad.
 */
export function placeLights(
  spec: MapSpec,
  lightRoles: Preset["lightRoles"],
  lightFixtures?: Preset["lightFixtures"],
): LightPlacement[] {
  const heroRoom = largestRoom(spec.rooms);
  const placements: LightPlacement[] = [];
  for (const room of spec.rooms) {
    const wallHeight = room.wallHeight ?? spec.wallHeight ?? config.defaultWallHeightStuds;
    const isHeroRoom = lightFixtures !== undefined || room === heroRoom;
    const role = isHeroRoom ? "hero" : "zoneMarker";
    placements.push({
      zone: room.name,
      role,
      position: { x: room.x, y: wallHeight - config.lightCeilingDropStuds, z: room.z },
      range: lightRoles[role].range,
      shadows: isHeroRoom,
    });
    if (lightFixtures !== undefined) {
      for (const fixture of fixtureBoxes(spec, room, lightFixtures)) {
        placements.push({
          zone: room.name,
          role: "zoneMarker",
          position: fixture.position,
          range: lightRoles.zoneMarker.range,
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
        range: lightRoles.focal.range,
        shadows: false,
      });
    }
  }
  return placements;
}
