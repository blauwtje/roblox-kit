import { z } from "zod";
import { config } from "../config.ts";
import { presetOverridesSchema } from "../style/preset-schema.ts";

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

const roomShape = {
  /** Zone name; unique in the map. */
  name: z.string().min(1),
  /** Outer size along X and along Z; walls stand inside this footprint. */
  width: positiveStud,
  depth: positiveStud,
  doors: z.array(doorSchema).default([]),
  /** Adds a SpawnLocation at the room center. */
  spawn: z.boolean().default(false),
  ...roomStyle,
};

/** A room at a given center on the ground plane; the floor's top face is at y = 0. */
const placedRoomSchema = z.strictObject({ ...roomShape, x: stud, z: stud });

/** A room set beside another room, joined to it by a hallway of the given size. */
const relatedRoomSchema = z.strictObject({
  ...roomShape,
  relation: z.strictObject({
    /** Name of the room this one is placed relative to. */
    to: z.string().min(1),
    /** Which side of the `to` room this room lies on; north is -Z, south +Z, east +X, west -X. */
    direction: z.enum(["north", "south", "east", "west"]),
    /** Hallway length between the two rooms' facing walls. */
    hallwayLength: positiveStud,
    hallwayWidth: positiveStud,
  }),
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

/** A genre preset by file name in `presets/`, and any subset of it to change. */
const styleSchema = z.strictObject({
  preset: z.string().min(1),
  overrides: presetOverridesSchema.optional(),
});

/** A named point of the map that a spawn should reach. */
const objectiveSchema = z.strictObject({
  name: z.string().min(1),
  x: stud,
  y: stud,
  z: stud,
});

/** Scene limits per zone camera; unset ones fall back to `config`. */
const performanceBudgetSchema = z.strictObject({
  maxDrawCalls: z.int().positive().default(config.maxDrawCalls),
  maxTriangles: z.int().positive().default(config.maxTriangles),
});

/** The budget of a spec that sets none: the `config` limits. */
export const defaultPerformanceBudget = performanceBudgetSchema.parse({});

/** The data spec of one map built from the given room schema: rooms, base terrain fills and style. */
function mapSpecOf<Room extends z.ZodType<{ name: string }>>(roomSchema: Room) {
  return z
    .strictObject({
      /** Name of the Model under `Workspace.RobloxKitMaps`; re-building the same id replaces it. */
      mapId: z.string().min(1),
      rooms: z.array(roomSchema).min(1),
      terrain: z.array(terrainFillSchema).default([]),
      /** Absent keeps the shipped defaults. */
      style: styleSchema.optional(),
      /** Seeds every random variation of the build; absent uses `config.defaultSeed`. */
      seed: z.int().nonnegative().optional(),
      objectives: z.array(objectiveSchema).optional(),
      performanceBudget: performanceBudgetSchema.default(() => defaultPerformanceBudget),
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
}

/** A spec whose rooms all have a center: what layout consumes, and what relations resolve to. */
export const mapSpecSchema = mapSpecOf(placedRoomSchema);

/** A spec whose rooms each give a center (`x`/`z`) or a `relation`, never both. */
export const relationMapSpecSchema = mapSpecOf(z.union([placedRoomSchema, relatedRoomSchema]));

export type MapSpec = z.output<typeof mapSpecSchema>;
export type RoomSpec = MapSpec["rooms"][number];
export type Objective = z.output<typeof objectiveSchema>;
export type PerformanceBudget = z.output<typeof performanceBudgetSchema>;
export type TerrainFill = MapSpec["terrain"][number];
export type RelationMapSpec = z.output<typeof relationMapSpecSchema>;
export type RelationRoomSpec = RelationMapSpec["rooms"][number];
