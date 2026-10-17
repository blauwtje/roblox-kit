import { resolveName } from "../shared/resolve-name.ts";
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

function canonicalRoomType(room: RelationRoomSpec, preset: Preset): RelationRoomSpec {
  if (room.roomType === undefined || preset.roomTypes === undefined) {
    return room;
  }
  return {
    ...room,
    roomType: resolveName(room.roomType, Object.keys(preset.roomTypes), "room type"),
  };
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
  const names = [...presets.keys()].join(", ");
  if (input.rooms === undefined && input.style?.preset === undefined) {
    throw new Error(`Give rooms or a style; the style presets are: ${names}`);
  }
  const presetName =
    input.style === undefined
      ? undefined
      : resolveName(input.style.preset, presets.keys(), "style preset");
  const preset = presetName === undefined ? undefined : presets.get(presetName);
  let { mapId, rooms } = input;
  if (rooms === undefined && preset !== undefined && presetName !== undefined) {
    const roomTypes = Object.keys(preset.roomTypes ?? {});
    if (roomTypes.length === 0) {
      throw new Error(`Style preset "${presetName}" declares no room types; give rooms.`);
    }
    rooms = roomsOf(preset, roomTypes);
    fills.push(`rooms: one room per "${presetName}" room type (${roomTypes.join(", ")})`);
  }
  if (rooms !== undefined && preset !== undefined) {
    rooms = rooms.map((room) => canonicalRoomType(room, preset));
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
  const style =
    input.style === undefined || presetName === undefined
      ? input.style
      : { ...input.style, preset: presetName };
  return { spec: { ...input, style, mapId, rooms }, fills };
}

type RelationMapSpecParts = Pick<RelationMapSpec, "mapId" | "rooms">;
