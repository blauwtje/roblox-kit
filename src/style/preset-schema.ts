import { z } from "zod";

/** Largest `Range` Roblox keeps on a PointLight, SpotLight or SurfaceLight (U7). */
const maxLightRange = 120;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a #rrggbb color");
const materialName = z.string().min(1);

/** The five surface roles a preset colors; a prop part takes one role's material and color. */
const surfaceRoleName = z.enum(["floor", "wall", "trim", "ceiling", "accent"]);

const surfaceRole = z.strictObject({
  /** Built-in Material name. */
  material: materialName,
  color: hexColor,
  /** A MaterialVariant renders flat color only, so it is a stylized finish, not a texture. */
  variant: z
    .strictObject({ baseMaterial: materialName, studsPerTile: z.number().positive() })
    .optional(),
});

const lightRole = z.strictObject({
  range: z.number().positive().max(maxLightRange),
  brightness: z.number().nonnegative(),
  color: hexColor,
});

/** Width, height and depth in studs. */
const studDimensions = z.strictObject({
  width: z.number().positive(),
  height: z.number().positive(),
  depth: z.number().positive(),
});

/**
 * The visible light fixtures repeated in each room. A sconce sits against the walls, `height` studs
 * above the floor; a pendant hangs in a grid, `drop` studs below the ceiling. Both measure to the
 * fixture's center and repeat every `spacing` studs.
 */
const lightFixtures = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("sconce"),
    spacing: z.number().positive(),
    height: z.number().positive(),
    size: studDimensions,
  }),
  z.strictObject({
    kind: z.literal("pendant"),
    spacing: z.number().positive(),
    drop: z.number().positive(),
    size: studDimensions,
  }),
]);

const atmosphere = z.strictObject({
  /** Roblox clamps Density to 0..1 (U9). */
  Density: z.number().min(0).max(1),
  Offset: z.number().nonnegative(),
  Color: hexColor,
  Decay: hexColor,
  Glare: z.number().nonnegative(),
  Haze: z.number().nonnegative(),
});

const bloom = z.strictObject({
  Intensity: z.number().nonnegative(),
  Size: z.number().nonnegative(),
  Threshold: z.number().nonnegative(),
});

const lighting = z.strictObject({
  LightingStyle: z.enum(["Realistic", "Soft"]),
  PrioritizeLightingQuality: z.boolean(),
  Ambient: hexColor,
  OutdoorAmbient: hexColor,
  Brightness: z.number().nonnegative(),
  /** The Roblox setter does not clamp, so the schema enforces the documented -5..5 (U8). */
  ExposureCompensation: z.number().min(-5).max(5),
  EnvironmentDiffuseScale: z.number().nonnegative(),
  EnvironmentSpecularScale: z.number().nonnegative(),
  ShadowSoftness: z.number().nonnegative(),
  Atmosphere: atmosphere,
  Bloom: bloom,
});

/** Fields every arrangement shares: the piece it repeats and an optional cap on how many it places. */
const arrangementBase = {
  /** Kind of the piece placed at each slot. */
  piece: z.string().min(1),
  /** Studs between neighboring pieces. */
  spacing: z.number().positive(),
  /** Caps the piece count so a large room stays inside its performance budget. */
  max: z.number().int().positive().optional(),
};

/** How a room type fills floor space, discriminated by `shape`; counts grow with the room's floor area. */
const arrangement = z.discriminatedUnion("shape", [
  /** A piece every `spacing` studs both ways. */
  z.strictObject({ shape: z.literal("grid"), ...arrangementBase }),
  /** Rows of `perRow` pieces, a row every `spacing` studs along the long axis. */
  z.strictObject({
    shape: z.literal("rows"),
    ...arrangementBase,
    perRow: z.number().int().positive(),
  }),
  /** A piece every `spacing` studs along each doorless wall or every wall, `inset` studs from it. */
  z.strictObject({
    shape: z.literal("along-walls"),
    ...arrangementBase,
    walls: z.enum(["doorless", "all"]),
    inset: z.number().nonnegative(),
  }),
  /** A line down the long axis, `inset` studs from the long wall the track bed is not on; the center line without `inset`. */
  z.strictObject({
    shape: z.literal("along-length"),
    ...arrangementBase,
    inset: z.number().nonnegative().optional(),
  }),
]);

/** A closed numeric range; `min` may equal `max`. */
const numberRange = z
  .strictObject({ min: z.number().positive(), max: z.number().positive() })
  .refine((range) => range.min <= range.max, "min must not exceed max");

/** What a prop kind may look like: its height as a share of the avatar's, and whether it may stand at any yaw. */
const propRule = z.strictObject({
  /** Prop height divided by avatar height; absent when the room's wall height sets the prop's height. */
  heightRatio: numberRange.optional(),
  /** False keeps the prop square to its wall or row, on the 90-degree grid. */
  freeRotation: z.boolean(),
  /** The surface role whose color and material the prop's parts take; absent keeps the generator's own look. */
  surface: surfaceRoleName.optional(),
});

const studPoint = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });

/** Fields every hero-prop part shares: the surface role it takes and where its center sits. */
const heroPartBase = {
  role: surfaceRoleName,
  /** Studs from the prop's footprint center on the floor (x across, y up, z along the depth). */
  center: studPoint,
};

/** One shape of a hero prop; the generator joins the parts of each role into one mesh. */
const heroPart = z.discriminatedUnion("shape", [
  z.strictObject({ shape: z.literal("box"), ...heroPartBase, size: studDimensions }),
  /** A cylinder whose axis runs along `axis`, `length` studs long. */
  z.strictObject({
    shape: z.literal("cylinder"),
    ...heroPartBase,
    radius: z.number().positive(),
    length: z.number().positive(),
    axis: z.enum(["x", "y", "z"]),
  }),
  /** A polygon of `points` (x across, y up) extruded `depth` studs along z, centered on `center`. */
  z.strictObject({
    shape: z.literal("profile"),
    ...heroPartBase,
    points: z.array(z.strictObject({ x: z.number(), y: z.number() })).min(3),
    depth: z.number().positive(),
  }),
]);

/** Most triangles a hero prop's mesh may hold, so a room's props stay inside its performance budget. */
const maxHeroTriangles = 20000;

/** A hero prop built from primitive shapes in studs: what it is, the set piece it replaces, its overall size and mesh budget. */
const heroProp = z.strictObject({
  description: z.string().min(1),
  /** Kind of the set piece this prop takes the slot of. */
  replaces: z.string().min(1),
  size: studDimensions,
  triangleBudget: z.number().int().positive().max(maxHeroTriangles),
  parts: z.array(heroPart).min(1),
});

/** What a room of one type shows: the set pieces that identify it, the arrangements that fill it, the text its signs carry and the room names a reviewer may call it. */
const roomType = z.strictObject({
  /** Set-piece kinds placed in a room of this type. */
  setPieces: z.array(z.string().min(1)),
  /** Arrangements that fill the space the set pieces leave. */
  arrangements: z.array(arrangement).optional(),
  /** Hero-prop kinds, declared in the preset's `heroProps`, that give the room its focal point. */
  heroProps: z.array(z.string().min(1)).min(1).max(2).optional(),
  signLabel: z.string().min(1),
  /** Room names, besides the type name, that the blind place check accepts for this type. */
  roomNames: z.array(z.string().min(1)).optional(),
});

/** One genre preset: palette, surface roles, lighting recipe and intent, light roles, prop kit and rules, room types and size rules. */
export const presetSchema = z.strictObject({
  palette: z.strictObject({
    colors: z.array(hexColor).min(3).max(4),
    accent: hexColor,
  }),
  surfaces: z.strictObject({
    floor: surfaceRole,
    wall: surfaceRole,
    trim: surfaceRole,
    ceiling: surfaceRole,
    accent: surfaceRole,
  }),
  lighting,
  /** The look the lighting recipe aims for, which the image rubric scores a room against. */
  lightingIntent: z.string().min(1),
  /** Only the hero light casts shadows, so no role carries a shadows field. */
  lightRoles: z.strictObject({
    zoneMarker: lightRole,
    focal: lightRole,
    hero: lightRole,
  }),
  /** Fixtures that hold a zone-marker light in a repeating pattern; absent leaves one center light per room. */
  lightFixtures: lightFixtures.optional(),
  /** Names of the props this genre may place. */
  propKit: z.array(z.string().min(1)).min(1),
  /** Scale and rotation rules keyed by prop kind, for every kind a room of this genre can place. */
  propRules: z.record(z.string().min(1), propRule),
  /** Hero-prop recipes keyed by hero kind; absent leaves every room to its primitive set pieces. */
  heroProps: z.record(z.string().min(1), heroProp).optional(),
  /** Room types this genre offers, keyed by type name; a room without a type keeps the plain prop kit. */
  roomTypes: z.record(z.string().min(1), roomType).optional(),
  sizeRules: z.strictObject({
    agentRadius: z.number().positive(),
    agentHeight: z.number().positive(),
    minDoorwayWidth: z.number().positive(),
    minHallwayWidth: z.number().positive(),
    minWallHeight: z.number().positive(),
    /** Studs tall the avatar spans, classic to humanoid; a prop's height ratio is measured against it. */
    avatarHeight: numberRange,
  }),
});

export type Preset = z.infer<typeof presetSchema>;

type DeepPartialShape<Shape extends z.ZodRawShape> = {
  [Key in keyof Shape]: z.ZodOptional<DeepPartialField<Shape[Key]>>;
};
type DeepPartialField<Field extends z.core.$ZodType> =
  Field extends z.ZodObject<infer Shape extends z.ZodRawShape, infer Config>
    ? z.ZodObject<DeepPartialShape<Shape>, Config>
    : Field;

/** Makes every field of an object schema and of its nested object schemas optional; arrays are replaced whole. */
function deepPartial<Shape extends z.ZodRawShape, Config extends z.core.$ZodObjectConfig>(
  schema: z.ZodObject<Shape, Config>,
): z.ZodObject<DeepPartialShape<Shape>, Config> {
  const partialShape: Record<string, z.ZodOptional> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    const nested = field instanceof z.ZodObject ? deepPartial(field) : field;
    partialShape[key] = z.optional(nested);
  }
  return z.strictObject(partialShape) as unknown as z.ZodObject<DeepPartialShape<Shape>, Config>;
}

/** The override a map spec's `style.overrides` carries: any subset of a preset. */
export const presetOverridesSchema = deepPartial(presetSchema);

export type PresetOverrides = z.infer<typeof presetOverridesSchema>;
