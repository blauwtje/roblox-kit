import { z } from "zod";

/** Largest `Range` Roblox keeps on a PointLight, SpotLight or SurfaceLight (U7). */
const maxLightRange = 120;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a #rrggbb color");
const materialName = z.string().min(1);

/** The five surface roles a preset colors; a prop part takes one role's material and color. */
const surfaceRoleName = z.enum(["floor", "wall", "trim", "ceiling", "accent"]);

/** The procedural patterns `src/style/material-recipe.py` bakes. */
export const materialPatterns = ["brick", "tile", "concrete", "metal", "plate", "panel"] as const;

/** The four maps a material recipe bakes, in the order of MaterialVariant's map properties. */
export const materialMapNames = ["color", "normal", "roughness", "metalness"] as const;

/** Pixels along one side of each map `src/style/material-recipe.py` bakes (its `SIZE`). */
export const materialMapSize = 512;

/**
 * Target texel density in pixels per stud for each surface role, from Roblox's guideline of 256 px per
 * 2 studs (128 px per stud, F7) at the close range of trim and accent, falling to half of that for floors
 * and walls and a third for a ceiling nobody stands near. A tile spans `materialMapSize / density` studs.
 */
export const roleTexelDensity = {
  floor: 64,
  wall: 64,
  trim: 128,
  ceiling: 43,
  accent: 128,
} as const;

/** Pixels per stud of a map tiled every `studsPerTile` studs. */
export function texelDensity(studsPerTile: number): number {
  return materialMapSize / studsPerTile;
}

/** Roblox's MaterialPattern: Organic breaks the visible repeat of a tiled texture. */
export const materialPatternNames = ["Regular", "Organic"] as const;

const unit = z.number().min(0).max(1);

/**
 * A role's procedural PBR material: baked by `npm run materials -- <preset>` to four tileable maps that are
 * uploaded as Images and written into the role's `variant.maps`. Only `pattern`, `seed`, `roughness` and
 * `metalness` shape the maps; `studsPerTile` is the size of one tile in the world.
 */
export const materialRecipeSchema = z.strictObject({
  pattern: z.enum(materialPatterns),
  seed: z.number().int().nonnegative(),
  roughness: unit,
  metalness: unit,
  studsPerTile: z.number().positive(),
});

export type MaterialRecipe = z.output<typeof materialRecipeSchema>;

const assetContentId = z.string().regex(/^rbxassetid:\/\/\d+$/, "expected rbxassetid://<digits>");

const materialMaps = z.strictObject({
  color: assetContentId,
  normal: assetContentId,
  roughness: assetContentId,
  metalness: assetContentId,
});

const surfaceRole = z.strictObject({
  /** Built-in Material name. */
  material: materialName,
  color: hexColor,
  /** The role's procedural material; its baked and uploaded maps land in `variant.maps`. */
  texture: materialRecipeSchema.optional(),
  /** A MaterialVariant without `maps` renders flat color only; with them it shows the baked texture. */
  variant: z
    .strictObject({
      baseMaterial: materialName,
      studsPerTile: z.number().positive(),
      /** Organic for natural surfaces (concrete, brick); Regular for patterned ones (tiles, panels, metal). */
      materialPattern: z.enum(materialPatternNames).optional(),
      maps: materialMaps.optional(),
    })
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

const colorCorrection = z.strictObject({
  Brightness: z.number().min(-1).max(1),
  Contrast: z.number().min(-1).max(1),
  Saturation: z.number().min(-1).max(1),
  TintColor: hexColor,
});

const sunRays = z.strictObject({
  Intensity: z.number().min(0).max(1),
  Spread: z.number().min(0).max(1),
});

const depthOfField = z.strictObject({
  FarIntensity: z.number().min(0).max(1),
  FocusDistance: z.number().nonnegative(),
  InFocusRadius: z.number().nonnegative(),
  NearIntensity: z.number().min(0).max(1),
});

/** The Sky sets no textures: the stars and celestial bodies come from the engine, so no asset enters the map. */
const sky = z.strictObject({
  StarCount: z.number().int().min(0).max(5000),
  CelestialBodiesShown: z.boolean(),
  SunAngularSize: z.number().min(0).max(100),
  MoonAngularSize: z.number().min(0).max(100),
});

/** Post-processing effects under Lighting, beside Atmosphere and Bloom. */
const postProcessing = z.strictObject({
  ColorCorrection: colorCorrection,
  SunRays: sunRays,
  DepthOfField: depthOfField,
  Sky: sky,
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
  /** Optional so a preset without it leaves these effects alone; an override replaces the whole block. */
  PostProcessing: postProcessing.optional(),
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
  /** Studs the prop stands away from its wall, in place of the generator's own depth; the track bed and platform edge read it. */
  depth: z.number().positive().optional(),
});

const studPoint = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });

/** The phases of a hero prop's recipe, in the order its operations run. */
export const heroPhases = ["blockout", "structure", "form", "material", "surface"] as const;

/** Fields every hero-prop operation shares: the phase that groups it. */
const heroOperationBase = { phase: z.enum(heroPhases) };

/** Fields every shape operation shares: the surface role it takes, where its center sits and its bevel. */
const heroShapeBase = {
  ...heroOperationBase,
  role: surfaceRoleName,
  /** Studs from the prop's footprint center on the floor (x across, y up, z along the depth). */
  center: studPoint,
  /** Studs of bevel on every edge of the shape, in place of a sharp edge. */
  bevel: z.number().positive().optional(),
};

/** Sides of a round shape, a cylinder or a lathe; the generator's own default when absent. */
const heroSegments = z.number().int().min(3).max(64).optional();

const profilePoint = z.strictObject({ x: z.number(), y: z.number() });

/** An operation that adds a piece; the cut and array operations after it change that piece. */
const heroShapeOperation = z.discriminatedUnion("op", [
  /** A box, bevelled on every edge when `bevel` is set. */
  z.strictObject({ op: z.literal("box"), ...heroShapeBase, size: studDimensions }),
  /** A cylinder whose axis runs along `axis`, `length` studs long. */
  z.strictObject({
    op: z.literal("cylinder"),
    ...heroShapeBase,
    radius: z.number().positive(),
    length: z.number().positive(),
    axis: z.enum(["x", "y", "z"]),
    segments: heroSegments,
  }),
  /** A closed ring of `points` (radius from the axis, offset along it) revolved once around `axis`. */
  z.strictObject({
    op: z.literal("lathe"),
    ...heroShapeBase,
    points: z.array(z.strictObject({ radius: z.number().positive(), offset: z.number() })).min(3),
    axis: z.enum(["x", "y", "z"]),
    segments: heroSegments,
  }),
  /** A polygon of `points` (x across, y up) extruded `depth` studs along z, centered on `center`. */
  z.strictObject({
    op: z.literal("profile"),
    ...heroShapeBase,
    points: z.array(profilePoint).min(3),
    depth: z.number().positive(),
  }),
  /** A closed polygon `section` (x across, y up) swept along `path`, whose points are studs from `center`. */
  z.strictObject({
    op: z.literal("sweep"),
    ...heroShapeBase,
    section: z.array(profilePoint).min(3),
    path: z.array(studPoint).min(2),
  }),
]);

/** A box subtracted from the piece the operation before it built, centered `center` studs from that piece's own center. */
const heroCutOperation = z.strictObject({
  op: z.literal("cut"),
  ...heroOperationBase,
  center: studPoint,
  size: studDimensions,
});

/** `count` copies of the piece the operations before it built, each `step` studs further than the one before; the first stays on the piece's center. */
const heroArrayOperation = z.strictObject({
  op: z.literal("array"),
  ...heroOperationBase,
  count: z.number().int().min(2).max(64),
  step: studPoint,
});

const heroOperation = z.union([heroShapeOperation, heroCutOperation, heroArrayOperation]);

export type HeroShapeOperation = z.output<typeof heroShapeOperation>;
type HeroCutOperation = z.output<typeof heroCutOperation>;
type HeroArrayOperation = z.output<typeof heroArrayOperation>;
type HeroOperation = z.output<typeof heroOperation>;

/** A shape with the cuts and the array that follow it in a recipe's operations. */
export interface HeroPart {
  shape: HeroShapeOperation;
  cuts: HeroCutOperation[];
  array?: HeroArrayOperation;
}

/** Groups a recipe's operations into its pieces: each shape operation takes the cut and array operations after it. */
export function heroParts(operations: HeroOperation[]): HeroPart[] {
  const parts: HeroPart[] = [];
  for (const operation of operations) {
    const part = parts.at(-1);
    if (operation.op === "cut") part?.cuts.push(operation);
    else if (operation.op === "array") {
      if (part !== undefined) part.array = operation;
    } else parts.push({ shape: operation, cuts: [] });
  }
  return parts;
}

/** Why a recipe's operations break the rules, or undefined: phases never go back, and a cut or array changes a piece that has no array yet. */
function heroOperationsProblem(operations: HeroOperation[]): string | undefined {
  let phaseIndex = 0;
  let pieceOpen = false;
  for (const [index, operation] of operations.entries()) {
    const operationPhase = heroPhases.indexOf(operation.phase);
    const label = `operation ${String(index)} (${operation.op})`;
    if (operationPhase < phaseIndex) return `${label} goes back to the ${operation.phase} phase`;
    phaseIndex = operationPhase;
    if (
      operation.op === "box" ||
      operation.op === "cylinder" ||
      operation.op === "lathe" ||
      operation.op === "profile" ||
      operation.op === "sweep"
    ) {
      pieceOpen = true;
    } else {
      if (!pieceOpen) return `${label} has no piece to change, or its piece already has an array`;
      if (operation.op === "array") pieceOpen = false;
    }
  }
  return undefined;
}
/** Most triangles a hero prop's mesh may hold, so a room's props stay inside its performance budget. */
const maxHeroTriangles = 20000;

/** A hero prop built from an ordered list of operations in studs: what it is, the set piece it replaces, its overall size and mesh budget. */
const heroProp = z.strictObject({
  description: z.string().min(1),
  /** Kind of the set piece this prop takes the slot of. */
  replaces: z.string().min(1),
  size: studDimensions,
  triangleBudget: z.number().int().positive().max(maxHeroTriangles),
  /** What builds the prop, phase by phase: the generator runs the operations in order and joins the pieces of each role into one mesh. */
  operations: z
    .array(heroOperation)
    .min(1)
    .superRefine((operations, context) => {
      const problem = heroOperationsProblem(operations);
      if (problem !== undefined) context.addIssue({ code: "custom", message: problem });
    }),
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
