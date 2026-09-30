import { config } from "../config.ts";
import type { Vector } from "../map/map-layout.ts";
import type { MapSpec, RoomSpec } from "../map/map-spec.ts";
import type { Preset } from "../style/preset-schema.ts";

export type LightRoleName = keyof Preset["lightRoles"];

/** One light to create: its role, where it hangs, its range and whether it casts shadows. */
export interface LightPlacement {
  role: LightRoleName;
  position: Vector;
  range: number;
  shadows: boolean;
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

/**
 * Places the lights of a map from a style's light roles. Every room gets one light at its center
 * below the ceiling: the hero in the largest room, a zone marker in each other room. A room with a
 * spawn pad gets a focal light over the pad. Only the hero casts shadows.
 */
export function placeLights(spec: MapSpec, lightRoles: Preset["lightRoles"]): LightPlacement[] {
  const heroRoom = largestRoom(spec.rooms);
  const placements: LightPlacement[] = [];
  for (const room of spec.rooms) {
    const wallHeight = room.wallHeight ?? spec.wallHeight ?? config.defaultWallHeightStuds;
    const isHeroRoom = room === heroRoom;
    const role = isHeroRoom ? "hero" : "zoneMarker";
    placements.push({
      role,
      position: { x: room.x, y: wallHeight - config.lightCeilingDropStuds, z: room.z },
      range: lightRoles[role].range,
      shadows: isHeroRoom,
    });
    if (room.spawn) {
      placements.push({
        role: "focal",
        position: { x: room.x, y: config.focalLightHeightStuds, z: room.z },
        range: lightRoles.focal.range,
        shadows: false,
      });
    }
  }
  return placements;
}
