import assert from "node:assert/strict";
import { test } from "node:test";
import { presetOverridesSchema, presetSchema } from "./preset-schema.ts";

const surface = { material: "Concrete", color: "#808080" };
const light = { range: 40, brightness: 1, color: "#ffffff" };

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
    lightRoles: { zoneMarker: light, focal: light, hero: light },
    propKit: ["bench", "lamp"],
    sizeRules: {
      agentRadius: 2,
      agentHeight: 5,
      minDoorwayWidth: 10,
      minHallwayWidth: 10,
      minWallHeight: 10,
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
