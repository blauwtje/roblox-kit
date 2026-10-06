import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { loadPresets } from "./load-preset.ts";
import {
  hexToOklab,
  lintColorsAgainstPalette,
  lintPalette,
  oklabDistance,
  oklabLightness,
} from "./palette-lint.ts";
import type { Preset } from "./preset-schema.ts";

const loaded = (await loadPresets()).get("train-station");
assert.ok(loaded !== undefined);
const preset: Preset = loaded;

/** The preset with its four lightness-bearing surface roles and palette replaced. */
function withSurfaces(
  colors: { floor: string; wall: string; ceiling: string; trim: string },
  palette: string[] = Object.values(colors),
): Preset {
  const surfaces = { ...preset.surfaces };
  for (const role of ["floor", "wall", "ceiling", "trim"] as const) {
    surfaces[role] = { ...surfaces[role], color: colors[role] };
  }
  const propSlots = Object.fromEntries(
    Object.entries(preset.propSlots).map(([slot, look]) => [
      slot,
      { ...look, color: colors.floor },
    ]),
  ) as Preset["propSlots"];
  return {
    ...preset,
    surfaces,
    propSlots,
    palette: { colors: palette.slice(0, 4), accent: surfaces.accent.color },
  };
}

const separated = { floor: "#303030", wall: "#808080", ceiling: "#f0f0f0", trim: "#585858" };

await test("OKLab matches the reference values for white, black and sRGB red", () => {
  const white = hexToOklab("#ffffff");
  assert.ok(Math.abs(white.l - 1) < 1e-3);
  assert.ok(Math.abs(white.a) < 1e-3 && Math.abs(white.b) < 1e-3);
  assert.equal(oklabLightness("#000000"), 0);
  const red = hexToOklab("#ff0000");
  assert.ok(Math.abs(red.l - 0.628) < 1e-3);
  assert.ok(Math.abs(red.a - 0.2249) < 1e-3);
  assert.ok(Math.abs(red.b - 0.1258) < 1e-3);
});

await test("oklabDistance is zero for equal colors and grows with difference", () => {
  assert.equal(oklabDistance("#336699", "#336699"), 0);
  assert.ok(oklabDistance("#336699", "#336a99") < oklabDistance("#336699", "#993366"));
  assert.ok(Math.abs(oklabDistance("#000000", "#ffffff") - 1) < 1e-3);
});

await test("well separated surfaces drawn from the palette give no issue", () => {
  assert.deepEqual(lintPalette(withSurfaces(separated)), []);
});

await test("a surface color outside the palette is a palette issue naming the role", () => {
  const issues = lintPalette(withSurfaces(separated, ["#303030", "#808080", "#f0f0f0", "#111111"]));
  const palette = issues.filter((issue) => issue.kind === "palette");
  assert.deepEqual(
    palette.map((issue) => issue.zone),
    ["trim"],
  );
  assert.match(String(palette[0]?.detail), /#585858/);
});

await test("a prop slot color outside the palette is a palette issue naming the slot", () => {
  const base = withSurfaces(separated);
  const issues = lintPalette({
    ...base,
    propSlots: { ...base.propSlots, glass: { ...base.propSlots.glass, color: "#ff00ff" } },
  });
  assert.deepEqual(
    issues.map((issue) => [issue.kind, issue.zone]),
    [["palette", "glass slot"]],
  );
});

await test("a color within the match distance of a palette color is a member", () => {
  const issues = lintColorsAgainstPalette({ frame: "#808081" }, withSurfaces(separated));
  assert.deepEqual(issues, []);
});

await test("lintColorsAgainstPalette labels each outside color, the accent counts as palette", () => {
  const issues = lintColorsAgainstPalette(
    { frame: "#ff00ff", light: preset.palette.accent },
    preset,
  );
  assert.deepEqual(
    issues.map((issue) => issue.zone),
    ["frame"],
  );
});

await test("two surfaces closer in lightness than the minimum are a value issue per pair", () => {
  const close = { ...separated, wall: "#808080", ceiling: "#858585" };
  const issues = lintPalette(withSurfaces(close)).filter((issue) => issue.kind === "value");
  assert.deepEqual(
    issues.map((issue) => issue.zone),
    ["wall/ceiling"],
  );
  assert.ok(
    Math.abs(oklabLightness("#808080") - oklabLightness("#858585")) <
      config.lookLint.minValueSeparation,
  );
});

await test("palette issues never carry a suggested spec patch", () => {
  const issues = lintPalette(
    withSurfaces({ ...separated, wall: "#303030" }, ["#000000", "#010101", "#020202"]),
  );
  assert.ok(issues.length > 0);
  assert.ok(issues.every((issue) => issue.suggestedSpecPatch === undefined));
});
