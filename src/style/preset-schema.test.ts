import assert from "node:assert/strict";
import { test } from "node:test";
import { heroParts, presetOverridesSchema, presetSchema } from "./preset-schema.ts";

const surface = { material: "Concrete", color: "#808080" };
const light = { range: 40, brightness: 1, color: "#ffffff" };
const slot = { color: "#808080", material: "Metal" };
const propSlotNames = ["frame", "seat", "panel", "glass", "screen", "signage", "light"] as const;

const ratio = { min: 0.1, max: 3 };
const ratios = { heightRatio: ratio, widthRatio: ratio, depthRatio: ratio };

function validPreset() {
  return {
    palette: { colors: ["#111111", "#222222", "#333333"], accent: "#ff8800" },
    surfaces: { floor: surface, wall: surface, trim: surface, ceiling: surface, accent: surface },
    lighting: {
      LightingStyle: "Soft",
      PrioritizeLightingQuality: true,
      Ambient: "#202020",
      OutdoorAmbient: "#303030",
      Brightness: 2,
      ExposureCompensation: 0.5,
      EnvironmentDiffuseScale: 0.5,
      EnvironmentSpecularScale: 0.5,
      ShadowSoftness: 0.2,
      Atmosphere: {
        Density: 0.3,
        Offset: 0.1,
        Color: "#aaaaaa",
        Decay: "#bbbbbb",
        Glare: 0,
        Haze: 1,
      },
      Bloom: { Intensity: 0.4, Size: 24, Threshold: 0.9 },
    },
    lightingIntent: "bright and even",
    lightRoles: { zoneMarker: light, focal: light, hero: light },
    propKit: ["bench", "lamp"],
    propSlots: Object.fromEntries(propSlotNames.map((name) => [name, slot])),
    propRules: {
      bench: {
        ...ratios,
        heightRatio: { min: 0.4, max: 0.8 },
        freeRotation: false,
        surface: "trim",
      },
      lamp: { ...ratios, freeRotation: false, surface: "exempt" },
      pillar: { ...ratios, freeRotation: false },
      "track-bed": { ...ratios, freeRotation: false, surface: "exempt" },
      "platform-edge": { ...ratios, freeRotation: false, surface: "exempt" },
      "departure-board": { ...ratios, freeRotation: false, surface: "exempt" },
    },
    sizeRules: {
      agentRadius: 2,
      agentHeight: 5,
      minDoorwayWidth: 10,
      minHallwayWidth: 10,
      minWallHeight: 10,
      avatarHeight: { min: 5, max: 6.5 },
    },
  };
}

await test("presetSchema accepts a complete preset", () => {
  assert.equal(presetSchema.safeParse(validPreset()).success, true);
});

await test("presetSchema rejects ExposureCompensation outside -5 to 5", () => {
  for (const exposure of [5.1, -5.1, 9]) {
    const preset = validPreset();
    preset.lighting.ExposureCompensation = exposure;
    assert.equal(presetSchema.safeParse(preset).success, false, `exposure ${String(exposure)}`);
  }
});

await test("presetSchema rejects Atmosphere Density outside 0 to 1", () => {
  for (const density of [-0.1, 5]) {
    const preset = validPreset();
    preset.lighting.Atmosphere.Density = density;
    assert.equal(presetSchema.safeParse(preset).success, false, `density ${String(density)}`);
  }
});

await test("presetSchema rejects a light Range over 120 and accepts 120", () => {
  const preset = validPreset();
  preset.lightRoles.hero = { ...light, range: 120 };
  assert.equal(presetSchema.safeParse(preset).success, true);
  preset.lightRoles.hero = { ...light, range: 121 };
  assert.equal(presetSchema.safeParse(preset).success, false);
});

await test("presetSchema needs 3 or 4 palette colors and a hex color", () => {
  const twoColors = validPreset();
  twoColors.palette.colors = ["#111111", "#222222"];
  assert.equal(presetSchema.safeParse(twoColors).success, false);
  const fiveColors = validPreset();
  fiveColors.palette.colors = ["#111111", "#222222", "#333333", "#444444", "#555555"];
  assert.equal(presetSchema.safeParse(fiveColors).success, false);
  const badColor = validPreset();
  badColor.palette.accent = "orange";
  assert.equal(presetSchema.safeParse(badColor).success, false);
});

await test("presetSchema rejects unknown fields and a shadows field on a light role", () => {
  const unknownField = { ...validPreset(), genre: "horror" };
  assert.equal(presetSchema.safeParse(unknownField).success, false);
  const preset = validPreset();
  preset.lightRoles.focal = { ...light, shadows: true } as typeof light;
  assert.equal(presetSchema.safeParse(preset).success, false);
});

await test("presetOverridesSchema accepts an empty override and nested partial overrides", () => {
  assert.equal(presetOverridesSchema.safeParse({}).success, true);
  const overrides = {
    lighting: { Brightness: 1, Atmosphere: { Density: 0.8 } },
    surfaces: { floor: { color: "#ffffff" } },
    sizeRules: { minWallHeight: 12 },
  };
  assert.deepEqual(presetOverridesSchema.parse(overrides), overrides);
});

await test("presetOverridesSchema keeps the preset ranges and strictness on partial fields", () => {
  const badExposure = { lighting: { ExposureCompensation: 9 } };
  assert.equal(presetOverridesSchema.safeParse(badExposure).success, false);
  const badDensity = { lighting: { Atmosphere: { Density: 5 } } };
  assert.equal(presetOverridesSchema.safeParse(badDensity).success, false);
  const badRange = { lightRoles: { hero: { range: 500 } } };
  assert.equal(presetOverridesSchema.safeParse(badRange).success, false);
  const unknownNested = { lighting: { Fog: 1 } };
  assert.equal(presetOverridesSchema.safeParse(unknownNested).success, false);
});

await test("presetSchema accepts room types with set pieces and a sign label, and works without them", () => {
  const preset = {
    ...validPreset(),
    roomTypes: { platform: { setPieces: ["track-bed", "platform-edge"], signLabel: "PLATFORM 1" } },
  };
  assert.equal(presetSchema.safeParse(preset).success, true);
  assert.equal(presetSchema.safeParse(validPreset()).success, true);
});

await test("presetSchema rejects a room type without a sign label or with an unknown field", () => {
  const noLabel = { ...validPreset(), roomTypes: { platform: { setPieces: ["track-bed"] } } };
  assert.equal(presetSchema.safeParse(noLabel).success, false);
  const emptyLabel = {
    ...validPreset(),
    roomTypes: { platform: { setPieces: [], signLabel: "" } },
  };
  assert.equal(presetSchema.safeParse(emptyLabel).success, false);
  const extra = {
    ...validPreset(),
    roomTypes: { platform: { setPieces: [], signLabel: "A", banner: "x" } },
  };
  assert.equal(presetSchema.safeParse(extra).success, false);
});

await test("presetOverridesSchema accepts a room types override", () => {
  const overrides = { roomTypes: { shop: { setPieces: ["counter"], signLabel: "SHOP" } } };
  assert.equal(presetOverridesSchema.safeParse(overrides).success, true);
});

const concourse = {
  setPieces: [],
  signLabel: "CONCOURSE",
  arrangements: [
    { shape: "grid", piece: "pillar", spacing: 20 },
    { shape: "rows", piece: "bench", spacing: 8, perRow: 3 },
    {
      shape: "along-walls",
      piece: "ticket-machine",
      spacing: 5,
      walls: "doorless",
      inset: 2,
      max: 6,
    },
    { shape: "along-length", piece: "lamp", spacing: 12 },
    { shape: "along-length", piece: "pillar", spacing: 15, inset: 4 },
  ],
  roomNames: ["waiting area", "hall"],
};

await test("presetSchema accepts every arrangement shape and accepted room names", () => {
  const preset = { ...validPreset(), roomTypes: { concourse } };
  assert.equal(presetSchema.safeParse(preset).success, true);
});

await test("presetSchema rejects an unknown arrangement shape", () => {
  const unknownShape = {
    ...concourse,
    arrangements: [{ shape: "spiral", piece: "pillar", spacing: 20 }],
  };
  const preset = { ...validPreset(), roomTypes: { concourse: unknownShape } };
  assert.equal(presetSchema.safeParse(preset).success, false);
});

await test("presetSchema rejects an arrangement missing a field of its shape or carrying another shape's", () => {
  const cases = [
    { shape: "rows", piece: "bench", spacing: 8 },
    { shape: "along-walls", piece: "bench", spacing: 8, walls: "doorless" },
    { shape: "along-walls", piece: "bench", spacing: 8, walls: "some", inset: 1 },
    { shape: "grid", piece: "pillar", spacing: 20, perRow: 3 },
    { shape: "grid", piece: "pillar", spacing: 0 },
    { shape: "grid", piece: "pillar", spacing: 20, max: 0 },
    { shape: "grid", piece: "", spacing: 20 },
  ];
  for (const badArrangement of cases) {
    const roomTypes = { concourse: { ...concourse, arrangements: [badArrangement] } };
    const preset = { ...validPreset(), roomTypes };
    assert.equal(presetSchema.safeParse(preset).success, false, JSON.stringify(badArrangement));
  }
});

await test("presetSchema rejects an empty accepted room name", () => {
  const roomTypes = { concourse: { ...concourse, roomNames: [""] } };
  assert.equal(presetSchema.safeParse({ ...validPreset(), roomTypes }).success, false);
});

await test("presetSchema needs a lighting intent, prop rules and an avatar height", () => {
  const withoutIntent: Record<string, unknown> = validPreset();
  delete withoutIntent["lightingIntent"];
  assert.equal(presetSchema.safeParse(withoutIntent).success, false);
  assert.equal(presetSchema.safeParse({ ...validPreset(), lightingIntent: "" }).success, false);

  const withoutRules: Record<string, unknown> = validPreset();
  delete withoutRules["propRules"];
  assert.equal(presetSchema.safeParse(withoutRules).success, false);

  const withoutAvatar = validPreset();
  const sizeRules: Record<string, unknown> = withoutAvatar.sizeRules;
  delete sizeRules["avatarHeight"];
  assert.equal(presetSchema.safeParse(withoutAvatar).success, false);
});

await test("presetSchema accepts a prop rule without a height ratio and rejects one without freeRotation", () => {
  const missingRotation = {
    ...validPreset(),
    propRules: { bench: { heightRatio: { min: 1, max: 2 } } },
  };
  assert.equal(presetSchema.safeParse(missingRotation).success, false);
});

await test("presetSchema accepts a prop rule with a surface role and rejects an unknown role", () => {
  for (const surface of ["floor", "wall", "trim", "ceiling", "accent", "exempt"]) {
    const preset = {
      ...validPreset(),
      propKit: ["bench"],
      propRules: { bench: { ...ratios, freeRotation: false, surface } },
    };
    assert.equal(presetSchema.safeParse(preset).success, true, surface);
  }
  const unknownRole = {
    ...validPreset(),
    propKit: ["bench"],
    propRules: { bench: { ...ratios, freeRotation: false, surface: "roof" } },
  };
  assert.equal(presetSchema.safeParse(unknownRole).success, false);
});

await test("presetSchema requires a surface for every prop kit and set-piece kind", () => {
  const noSurface: { freeRotation: boolean; surface?: string } = { ...ratios, freeRotation: false };
  const kitKind = { ...validPreset(), propRules: { ...validPreset().propRules, lamp: noSurface } };
  assert.equal(presetSchema.safeParse(kitKind).success, false);

  const setPiece = {
    ...validPreset(),
    roomTypes: { shop: { setPieces: ["counter"], signLabel: "Shop" } },
    propRules: { ...validPreset().propRules, counter: noSurface },
  };
  assert.equal(presetSchema.safeParse(setPiece).success, false);
  setPiece.propRules.counter = { ...ratios, freeRotation: false, surface: "exempt" };
  assert.equal(presetSchema.safeParse(setPiece).success, true);

  const missingRule = { ...validPreset(), propKit: ["bench", "lamp", "sofa"] };
  assert.equal(presetSchema.safeParse(missingRule).success, false);
});

await test("presetSchema requires a height, width and depth ratio for every prop kit and set-piece kind", () => {
  for (const missing of ["heightRatio", "widthRatio", "depthRatio"] as const) {
    const rest = Object.fromEntries(Object.entries(ratios).filter(([key]) => key !== missing));
    const kitKind = {
      ...validPreset(),
      propRules: {
        ...validPreset().propRules,
        lamp: { ...rest, freeRotation: false, surface: "exempt" },
      },
    };
    const result = presetSchema.safeParse(kitKind);
    assert.equal(result.success, false, missing);
    assert.deepEqual(result.error.issues[0]?.path, ["propRules", "lamp", missing]);

    const setPiece = {
      ...validPreset(),
      roomTypes: { shop: { setPieces: ["counter"], signLabel: "Shop" } },
      propRules: {
        ...validPreset().propRules,
        counter: { ...rest, freeRotation: false, surface: "exempt" },
      },
    };
    assert.equal(presetSchema.safeParse(setPiece).success, false, `${missing} on a set piece`);
  }
  const widthOutOfOrder = {
    ...validPreset(),
    propRules: {
      ...validPreset().propRules,
      lamp: { ...ratios, widthRatio: { min: 2, max: 1 }, freeRotation: false, surface: "exempt" },
    },
  };
  assert.equal(presetSchema.safeParse(widthOutOfOrder).success, false);
});

await test("presetSchema allows Neon only on the screen and light slots", () => {
  const neon = { color: "#ff0000", material: "Neon" };
  for (const name of propSlotNames) {
    const preset = validPreset();
    preset.propSlots = { ...preset.propSlots, [name]: neon };
    const allowed = name === "screen" || name === "light";
    assert.equal(presetSchema.safeParse(preset).success, allowed, name);
  }
});

await test("presetSchema requires every prop slot and a hex color in it", () => {
  const missing = validPreset();
  delete (missing.propSlots as Record<string, unknown>)["glass"];
  assert.equal(presetSchema.safeParse(missing).success, false);

  const badColor = validPreset();
  badColor.propSlots = { ...badColor.propSlots, frame: { color: "red", material: "Metal" } };
  assert.equal(presetSchema.safeParse(badColor).success, false);
});

await test("presetSchema rejects a height range whose min exceeds its max or is not positive", () => {
  for (const heightRatio of [
    { min: 2, max: 1 },
    { min: 0, max: 1 },
    { min: 1, max: 2, extra: 1 },
  ]) {
    const preset = { ...validPreset(), propRules: { bench: { heightRatio, freeRotation: false } } };
    assert.equal(presetSchema.safeParse(preset).success, false);
  }
  const preset = validPreset();
  preset.sizeRules.avatarHeight = { min: 7, max: 6 };
  assert.equal(presetSchema.safeParse(preset).success, false);
});

await test("presetOverridesSchema accepts a partial avatar height and a prop rules override", () => {
  const overrides = {
    lightingIntent: "dim",
    sizeRules: { avatarHeight: { max: 7 } },
    propRules: { bench: { freeRotation: true } },
  };
  assert.equal(presetOverridesSchema.safeParse(overrides).success, true);
});

const fixtureSize = { width: 2, height: 3, depth: 1 };

await test("presetSchema accepts a sconce or a pendant fixture pattern, and works without one", () => {
  const sconce = { kind: "sconce", spacing: 10, height: 8, size: fixtureSize };
  const pendant = { kind: "pendant", spacing: 12, drop: 4, size: fixtureSize };
  for (const lightFixtures of [sconce, pendant, undefined]) {
    const result = presetSchema.safeParse({ ...validPreset(), lightFixtures });
    assert.equal(result.success, true, JSON.stringify(lightFixtures));
  }
});

await test("presetSchema rejects a fixture pattern with another kind's field, a missing field or a non-positive spacing", () => {
  const invalid = [
    { kind: "sconce", spacing: 10, drop: 4, size: fixtureSize },
    { kind: "pendant", spacing: 10, height: 8, size: fixtureSize },
    { kind: "sconce", spacing: 10, size: fixtureSize },
    { kind: "sconce", spacing: 0, height: 8, size: fixtureSize },
    { kind: "sconce", spacing: 10, height: 8, size: { width: 2, height: 3 } },
    { kind: "lantern", spacing: 10, height: 8, size: fixtureSize },
  ];
  for (const lightFixtures of invalid) {
    const result = presetSchema.safeParse({ ...validPreset(), lightFixtures });
    assert.equal(result.success, false, JSON.stringify(lightFixtures));
  }
});

const heroCar = {
  description: "a low-poly train car",
  replaces: "track-bed",
  size: { width: 10, height: 12, depth: 40 },
  triangleBudget: 20000,
  operations: [
    {
      op: "box",
      phase: "blockout",
      role: "wall",
      center: { x: 0, y: 6, z: 0 },
      size: fixtureSize,
    },
    {
      op: "cylinder",
      phase: "structure",
      role: "trim",
      center: { x: 0, y: 1, z: 0 },
      radius: 1,
      length: 8,
      axis: "x",
    },
    {
      op: "profile",
      phase: "form",
      role: "accent",
      center: { x: 0, y: 8, z: 0 },
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 2, y: 3 },
      ],
      depth: 20,
    },
  ],
};

const roomWithHero = (heroProps: string[]) => ({
  concourse: { setPieces: ["departure-board"], signLabel: "Concourse", heroProps },
});

await test("presetSchema accepts a hero prop recipe with box, cylinder and profile operations and a room type that declares it", () => {
  const preset = {
    ...validPreset(),
    heroProps: { "train-car": heroCar },
    roomTypes: roomWithHero(["train-car"]),
  };
  assert.equal(presetSchema.safeParse(preset).success, true);
});

await test("presetSchema rejects a hero prop over 20000 triangles and accepts exactly 20000", () => {
  const over = { ...heroCar, triangleBudget: 20001 };
  assert.equal(
    presetSchema.safeParse({ ...validPreset(), heroProps: { car: over } }).success,
    false,
  );
  const atLimit = { ...heroCar, triangleBudget: 20000 };
  assert.equal(
    presetSchema.safeParse({ ...validPreset(), heroProps: { car: atLimit } }).success,
    true,
  );
});

await test("presetSchema rejects a hero prop recipe missing a field or carrying an unknown one", () => {
  for (const field of ["description", "replaces", "size", "triangleBudget", "operations"]) {
    const recipe = Object.fromEntries(Object.entries(heroCar).filter(([key]) => key !== field));
    const preset = { ...validPreset(), heroProps: { car: recipe } };
    assert.equal(presetSchema.safeParse(preset).success, false, field);
  }
  const extra = { ...heroCar, mesh: "car.glb" };
  assert.equal(
    presetSchema.safeParse({ ...validPreset(), heroProps: { car: extra } }).success,
    false,
  );
  const noOperations = { ...heroCar, operations: [] };
  assert.equal(
    presetSchema.safeParse({ ...validPreset(), heroProps: { car: noOperations } }).success,
    false,
  );
});

const shapeCenter = { x: 0, y: 0, z: 0 };
const heroSquare = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];
const heroRing = [
  { radius: 1, offset: -1 },
  { radius: 2, offset: -1 },
  { radius: 2, offset: 1 },
];
const heroWith = (operations: object[]) => ({
  ...validPreset(),
  heroProps: { car: { ...heroCar, operations } },
});
const heroBox = {
  op: "box",
  phase: "structure",
  role: "wall",
  center: shapeCenter,
  size: fixtureSize,
};
const heroCut = { op: "cut", phase: "structure", center: shapeCenter, size: fixtureSize };
const heroArray = { op: "array", phase: "structure", count: 4, step: { x: 3, y: 0, z: 0 } };

await test("presetSchema rejects a hero prop operation with an unknown op, phase or role, another op's field or too few profile points", () => {
  const invalidOperations = [
    { op: "sphere", phase: "form", role: "wall", center: shapeCenter, radius: 1 },
    { ...heroBox, role: "roof" },
    { ...heroBox, phase: "polish" },
    { ...heroBox, phase: undefined },
    { ...heroBox, radius: 1 },
    { ...heroBox, shape: "box" },
    {
      op: "cylinder",
      phase: "form",
      role: "wall",
      center: shapeCenter,
      radius: 1,
      length: 2,
      axis: "w",
    },
    {
      op: "profile",
      phase: "form",
      role: "wall",
      center: shapeCenter,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      depth: 1,
    },
  ];
  for (const operation of invalidOperations) {
    const result = presetSchema.safeParse(heroWith([operation]));
    assert.equal(result.success, false, JSON.stringify(operation));
  }
});

await test("presetSchema accepts lathe and sweep operations, a bevel, cuts, an array and segments", () => {
  const validOperations = [
    [
      {
        op: "lathe",
        phase: "form",
        role: "wall",
        center: shapeCenter,
        points: heroRing,
        axis: "z",
        segments: 16,
      },
    ],
    [
      {
        op: "sweep",
        phase: "form",
        role: "trim",
        center: shapeCenter,
        section: heroSquare,
        path: [shapeCenter, { x: 0, y: 4, z: 0 }],
      },
    ],
    [{ ...heroBox, bevel: 0.1 }, heroCut, heroCut, heroArray],
    [
      { ...heroBox, phase: "blockout" },
      { ...heroCut, phase: "form" },
      { ...heroArray, phase: "surface" },
    ],
    [
      {
        op: "cylinder",
        phase: "material",
        role: "wall",
        center: shapeCenter,
        radius: 1,
        length: 2,
        axis: "y",
        segments: 8,
      },
    ],
  ];
  for (const operations of validOperations) {
    const result = presetSchema.safeParse(heroWith(operations));
    assert.equal(result.success, true, JSON.stringify(operations));
  }
});

await test("presetSchema rejects bad lathe, sweep, bevel, cut, array and segments values", () => {
  const lathe = { op: "lathe", phase: "form", role: "wall", center: shapeCenter, axis: "z" };
  const invalidOperations = [
    [{ ...lathe, points: heroRing.slice(0, 2) }],
    [{ ...lathe, points: heroRing, axis: "w" }],
    [{ ...lathe, points: [{ radius: 0, offset: 0 }, ...heroRing] }],
    [{ ...lathe, points: heroRing, segments: 2 }],
    [
      {
        op: "sweep",
        phase: "form",
        role: "trim",
        center: shapeCenter,
        section: heroSquare,
        path: [shapeCenter],
      },
    ],
    [
      {
        op: "sweep",
        phase: "form",
        role: "trim",
        center: shapeCenter,
        section: heroSquare.slice(0, 2),
        path: [shapeCenter, { x: 0, y: 4, z: 0 }],
      },
    ],
    [{ ...heroBox, bevel: 0 }],
    [{ ...heroBox, bevel: -1 }],
    [heroBox, { op: "cut", phase: "structure", center: shapeCenter }],
    [heroBox, { ...heroCut, role: "wall" }],
    [heroBox, { ...heroArray, count: 1 }],
    [heroBox, { ...heroArray, count: 65 }],
    [heroBox, { op: "array", phase: "structure", count: 3 }],
    [
      {
        op: "cylinder",
        phase: "form",
        role: "wall",
        center: shapeCenter,
        radius: 1,
        length: 2,
        axis: "y",
        segments: 65,
      },
    ],
  ];
  for (const operations of invalidOperations) {
    const result = presetSchema.safeParse(heroWith(operations));
    assert.equal(result.success, false, JSON.stringify(operations));
  }
});

await test("presetSchema rejects hero prop operations whose phase goes back, or a cut or array with no piece to change", () => {
  const invalidOperations = {
    "phase goes back": [
      { ...heroBox, phase: "form" },
      { ...heroBox, phase: "structure" },
    ],
    "cut goes back": [
      { ...heroBox, phase: "form" },
      { ...heroCut, phase: "blockout" },
    ],
    "cut first": [heroCut, heroBox],
    "array first": [heroArray, heroBox],
    "cut after an array": [heroBox, heroArray, heroCut],
    "second array": [heroBox, heroArray, heroArray],
  };
  for (const [name, operations] of Object.entries(invalidOperations)) {
    const result = presetSchema.safeParse(heroWith(operations));
    assert.equal(result.success, false, name);
  }
});

await test("heroParts gives each shape the cuts and the array after it, in order", () => {
  const second = { ...heroBox, role: "trim", phase: "form" } as const;
  const parsed = presetSchema.parse(
    heroWith([heroBox, heroCut, heroArray, second, { ...heroCut, phase: "form" }]),
  );
  const operations = parsed.heroProps?.car?.operations ?? [];
  const [box, cut, array, trim, trimCut] = operations;
  assert.deepEqual(heroParts(operations), [
    { shape: box, cuts: [cut], array },
    { shape: trim, cuts: [trimCut] },
  ]);
});

await test("presetSchema takes 1 or 2 hero prop kinds on a room type and rejects none or 3", () => {
  for (const [kinds, accepted] of [
    [["a"], true],
    [["a", "b"], true],
    [[], false],
    [["a", "b", "c"], false],
  ] as const) {
    const preset = { ...validPreset(), roomTypes: roomWithHero([...kinds]) };
    assert.equal(presetSchema.safeParse(preset).success, accepted, kinds.join());
  }
});

await test("presetSchema works without hero props and presetOverridesSchema accepts a hero props override", () => {
  assert.equal(presetSchema.safeParse(validPreset()).success, true);
  const overrides = { heroProps: { "train-car": heroCar } };
  assert.equal(presetOverridesSchema.safeParse(overrides).success, true);
});

const brickRecipe = {
  pattern: "brick",
  seed: 3,
  roughness: 0.8,
  metalness: 0,
  studsPerTile: 8,
};
const brickMaps = {
  color: "rbxassetid://101",
  normal: "rbxassetid://102",
  roughness: "rbxassetid://103",
  metalness: "rbxassetid://104",
};

function withWall(wall: Record<string, unknown>) {
  const preset = validPreset();
  return { ...preset, surfaces: { ...preset.surfaces, wall: { ...surface, ...wall } } };
}

await test("presetSchema takes a material recipe on a role, and a variant with or without its four maps", () => {
  const variant = { baseMaterial: "Concrete", studsPerTile: 8 };
  for (const wall of [
    { texture: brickRecipe },
    { texture: brickRecipe, variant },
    { texture: brickRecipe, variant: { ...variant, maps: brickMaps } },
  ]) {
    assert.equal(presetSchema.safeParse(withWall(wall)).success, true, JSON.stringify(wall));
  }
});

await test("presetSchema rejects a bad material recipe or map", () => {
  const variant = { baseMaterial: "Concrete", studsPerTile: 8 };
  const threeMaps = {
    color: brickMaps.color,
    roughness: brickMaps.roughness,
    metalness: brickMaps.metalness,
  };
  for (const wall of [
    { texture: { ...brickRecipe, pattern: "marble" } },
    { texture: { ...brickRecipe, seed: 1.5 } },
    { texture: { ...brickRecipe, roughness: 1.2 } },
    { texture: { ...brickRecipe, metalness: -0.1 } },
    { texture: { ...brickRecipe, studsPerTile: 0 } },
    { texture: { ...brickRecipe, extra: 1 } },
    { variant: { ...variant, maps: threeMaps } },
    { variant: { ...variant, maps: { ...brickMaps, color: "rbxassetid://abc" } } },
    { variant: { ...variant, maps: { ...brickMaps, color: "101" } } },
  ]) {
    assert.equal(presetSchema.safeParse(withWall(wall)).success, false, JSON.stringify(wall));
  }
});

await test("presetSchema takes idle animations per prop kind with a top or bottom hinge", () => {
  const sign = { swayDegrees: 3, periodSeconds: 4, hinge: "top" };
  assert.ok(presetSchema.safeParse({ ...validPreset(), idleAnimations: { sign } }).success);
  for (const bad of [
    { ...sign, hinge: "middle" },
    { ...sign, swayDegrees: 0 },
    { ...sign, periodSeconds: -1 },
    { ...sign, extra: 1 },
  ]) {
    assert.equal(
      presetSchema.safeParse({ ...validPreset(), idleAnimations: { sign: bad } }).success,
      false,
      JSON.stringify(bad),
    );
  }
});
