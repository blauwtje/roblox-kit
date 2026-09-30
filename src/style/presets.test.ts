import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPresets } from "./load-preset.ts";

const genreNames = ["cozy-town", "horror-facility", "sci-fi-station", "train-station"];

/** Names in Enum.Material that these presets may use; "built-in Materials only" means no custom ones. */
const builtInMaterials = new Set([
  "Brick",
  "Concrete",
  "DiamondPlate",
  "Fabric",
  "Marble",
  "Metal",
  "Neon",
  "Plaster",
  "Slate",
  "SmoothPlastic",
  "Wood",
  "WoodPlanks",
]);

await test("the bundled presets folder holds the four genre presets", async () => {
  const presets = await loadPresets();
  assert.deepEqual([...presets.keys()], genreNames);
});

await test("every bundled preset uses built-in Materials only and sets no MaterialVariant", async () => {
  const presets = await loadPresets();
  for (const [name, preset] of presets) {
    for (const [role, surface] of Object.entries(preset.surfaces)) {
      assert.ok(builtInMaterials.has(surface.material), `${name} ${role}: ${surface.material}`);
      // A variant without texture maps renders flat color and hides the material's texture.
      assert.equal(surface.variant, undefined, `${name} ${role} sets a MaterialVariant`);
    }
  }
});

await test("every bundled preset meets the size rules check_map enforces", async () => {
  const presets = await loadPresets();
  for (const [name, preset] of presets) {
    assert.ok(preset.sizeRules.minDoorwayWidth >= 10, `${name} doorway`);
    assert.ok(preset.sizeRules.minHallwayWidth >= 10, `${name} hallway`);
    assert.ok(preset.sizeRules.minWallHeight >= 10, `${name} wall height`);
  }
});
