import type { Preset } from "../style/preset-schema.ts";
import type { RelationMapSpec, RelationRoomSpec } from "./map-spec.ts";

/** Sizes of the rooms and hallways a fill creates; the preset's `sizeRules` set hallway width and wall height. */
export const fillDefaults = Object.freeze({
  roomWidth: 40,
  roomDepth: 40,
  hallwayLength: 15,
});

/** A map spec whose `mapId` and `rooms` may be absent. */
export type PartialMapSpec = Omit<RelationMapSpec, "mapId" | "rooms"> & {
  mapId?: string | undefined;
  rooms?: RelationRoomSpec[] | undefined;
};

function roomsOf(preset: Preset, roomTypes: string[]): RelationRoomSpec[] {
  const { minHallwayWidth, minWallHeight } = preset.sizeRules;
  const base = {
    width: fillDefaults.roomWidth,
    depth: fillDefaults.roomDepth,
    wallHeight: minWallHeight,
  };
  return roomTypes.map((roomType, index) => {
    const previous = roomTypes[index - 1];
    if (previous === undefined) {
      return { ...base, name: roomType, roomType, x: 0, z: 0, spawn: true, doors: [] };
    }
    return {
      ...base,
      name: roomType,
      roomType,
      spawn: false,
      doors: [],
      relation: {
        to: previous,
        direction: "east",
        hallwayLength: fillDefaults.hallwayLength,
        hallwayWidth: minHallwayWidth,
      },
    };
  });
}

/**
 * Fills an absent `mapId` with the preset name and absent `rooms` with one room per preset room type.
 * Returns the same spec and no fills when both are given. Never turns on npcs, clutter, signage, motion
 * or recorded assets. Throws, listing the preset names, when there is neither `style` nor `rooms`.
 */
export function fillMapSpec<Input extends PartialMapSpec>(
  input: Input,
  presets: ReadonlyMap<string, Preset>,
): { spec: Omit<Input, "mapId" | "rooms"> & RelationMapSpecParts; fills: string[] } {
  const fills: string[] = [];
  const presetName = input.style?.preset;
  const names = [...presets.keys()].join(", ");
  if (input.rooms === undefined && presetName === undefined) {
    throw new Error(`Give rooms or a style; the style presets are: ${names}`);
  }
  let { mapId, rooms } = input;
  if (rooms === undefined && presetName !== undefined) {
    const preset = presets.get(presetName);
    if (preset === undefined) {
      throw new Error(`Unknown style preset "${presetName}"; the style presets are: ${names}`);
    }
    const roomTypes = Object.keys(preset.roomTypes ?? {});
    if (roomTypes.length === 0) {
      throw new Error(`Style preset "${presetName}" declares no room types; give rooms.`);
    }
    rooms = roomsOf(preset, roomTypes);
    fills.push(`rooms: one room per "${presetName}" room type (${roomTypes.join(", ")})`);
  }
  if (mapId === undefined && presetName !== undefined) {
    mapId = presetName;
    fills.push(`mapId: "${presetName}" (the preset name)`);
  }
  if (mapId === undefined || rooms === undefined) {
    throw new Error(
      `Give a mapId, or a style whose name it can take; the style presets are: ${names}`,
    );
  }
  const seenNames = new Set<string>();
  for (const room of rooms) {
    if (seenNames.has(room.name)) {
      throw new Error(`Room name "${room.name}" is used twice; zone names must be unique.`);
    }
    seenNames.add(room.name);
  }
  return { spec: { ...input, mapId, rooms }, fills };
}

type RelationMapSpecParts = Pick<RelationMapSpec, "mapId" | "rooms">;
