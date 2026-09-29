import { z } from "zod";

const stud = z.number();
const positiveStud = stud.positive();
const materialName = z.string().min(1);
const vector = z.strictObject({ x: stud, y: stud, z: stud });
const positiveVector = z.strictObject({ x: positiveStud, y: positiveStud, z: positiveStud });

/** Settings a map sets for all rooms and a room may override; unset ones fall back to `config`. */
const roomStyle = {
  floorMaterial: materialName.optional(),
  wallMaterial: materialName.optional(),
  wallHeight: positiveStud.optional(),
  wallThickness: positiveStud.optional(),
  doorWidth: positiveStud.optional(),
};

const doorSchema = z.strictObject({
  /** North is -Z, south +Z, east +X, west -X. */
  side: z.enum(["north", "south", "east", "west"]),
  /** Distance of the door center from the wall center along the wall. */
  offset: stud.default(0),
});

const roomSchema = z.strictObject({
  /** Zone name; unique in the map. */
  name: z.string().min(1),
  /** Center of the room on the ground plane; the floor's top face is at y = 0. */
  x: stud,
  z: stud,
  /** Outer size along X and along Z; walls stand inside this footprint. */
  width: positiveStud,
  depth: positiveStud,
  doors: z.array(doorSchema).default([]),
  /** Adds a SpawnLocation at the room center. */
  spawn: z.boolean().default(false),
  ...roomStyle,
});

const terrainFillSchema = z.discriminatedUnion("shape", [
  z.strictObject({
    shape: z.literal("block"),
    center: vector,
    size: positiveVector,
    material: materialName,
  }),
  z.strictObject({
    shape: z.literal("ball"),
    center: vector,
    radius: positiveStud,
    material: materialName,
  }),
]);

/** The data spec of one map: rooms with floors, walls and doors, plus base terrain fills. */
export const mapSpecSchema = z
  .strictObject({
    /** Name of the Model under `Workspace.RobloxKitMaps`; re-building the same id replaces it. */
    mapId: z.string().min(1),
    rooms: z.array(roomSchema).min(1),
    terrain: z.array(terrainFillSchema).default([]),
    ...roomStyle,
  })
  .superRefine((spec, context) => {
    const seenNames = new Set<string>();
    for (const [index, room] of spec.rooms.entries()) {
      if (seenNames.has(room.name)) {
        context.addIssue({
          code: "custom",
          message: `Room name "${room.name}" is used twice; zone names must be unique.`,
          path: ["rooms", index, "name"],
        });
      }
      seenNames.add(room.name);
    }
  });

export type MapSpec = z.output<typeof mapSpecSchema>;
export type RoomSpec = MapSpec["rooms"][number];
export type TerrainFill = MapSpec["terrain"][number];
