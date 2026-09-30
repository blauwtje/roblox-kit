import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPresets } from "./load-preset.ts";
import { resolveStyle } from "./resolve-style.ts";

const presets = await loadPresets();

await test("a preset without overrides resolves to that preset", () => {
  assert.deepEqual(resolveStyle(presets, { preset: "cozy-town" }), presets.get("cozy-town"));
});

await test("overrides merge deeply and leave sibling fields of the preset intact", () => {
  const base = presets.get("horror-facility");
  assert.ok(base);
  const resolved = resolveStyle(presets, {
    preset: "horror-facility",
    overrides: { lighting: { Atmosphere: { Density: 0.05 } }, sizeRules: { minDoorwayWidth: 9 } },
  });
  assert.equal(resolved.lighting.Atmosphere.Density, 0.05);
  assert.equal(resolved.lighting.Atmosphere.Color, base.lighting.Atmosphere.Color);
  assert.equal(resolved.lighting.Bloom.Size, base.lighting.Bloom.Size);
  assert.equal(resolved.sizeRules.minDoorwayWidth, 9);
  assert.equal(resolved.sizeRules.agentRadius, base.sizeRules.agentRadius);
});

await test("an array override replaces the preset array whole", () => {
  const resolved = resolveStyle(presets, { preset: "cozy-town", overrides: { propKit: ["lamp"] } });
  assert.deepEqual(resolved.propKit, ["lamp"]);
});

await test("resolving does not mutate the loaded preset", () => {
  const before = structuredClone(presets.get("sci-fi-station"));
  resolveStyle(presets, {
    preset: "sci-fi-station",
    overrides: { lighting: { Brightness: 0.1 }, palette: { accent: "#123456" } },
  });
  assert.deepEqual(presets.get("sci-fi-station"), before);
});

await test("an unknown preset throws naming it and the known presets", () => {
  assert.throws(
    () => resolveStyle(presets, { preset: "medieval" }),
    /Unknown style preset "medieval".*cozy-town/,
  );
});

await test("an override out of range throws", () => {
  assert.throws(
    () =>
      resolveStyle(presets, {
        preset: "cozy-town",
        overrides: { lighting: { ExposureCompensation: 9 } },
      }),
    /Invalid style overrides/,
  );
});

await test("an override with an unknown key throws", () => {
  assert.throws(
    () => resolveStyle(presets, { preset: "cozy-town", overrides: { fog: true } }),
    /Invalid style overrides/,
  );
});

await test("an override that breaks an array length rule throws", () => {
  assert.throws(
    () =>
      resolveStyle(presets, {
        preset: "cozy-town",
        overrides: { palette: { colors: ["#111111"] } },
      }),
    /Invalid style overrides/,
  );
});
