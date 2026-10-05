import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPresets } from "./load-preset.ts";
import { mapSpecSchema } from "../map/map-spec.ts";
import { progressionFactor, resolveStyle, roomProgression } from "./resolve-style.ts";

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

const rowDoors = [
  { name: "a", x: 0, doors: [{ side: "east", offset: 0 }], spawn: true },
  {
    name: "b",
    x: 20,
    doors: [
      { side: "west", offset: 0 },
      { side: "east", offset: 0 },
    ],
  },
  { name: "c", x: 40, doors: [{ side: "west", offset: 0 }] },
  { name: "island", x: 100, doors: [] },
].map((room) => ({ width: 20, depth: 20, z: 0, ...room }));

await test("progression runs from 0 at the spawn room to 1 at the room farthest by doors", () => {
  const progression = roomProgression(mapSpecSchema.parse({ mapId: "m", rooms: rowDoors }));
  assert.deepEqual(
    [...progression],
    [
      ["a", 0],
      ["b", 0.5],
      ["c", 1],
      ["island", 0],
    ],
  );
});

await test("doors that do not line up, or a map without a spawn room, leave every room at 0", () => {
  const shifted = rowDoors.map((room) =>
    room.name === "b" ? { ...room, doors: [{ side: "west", offset: 5 }] } : room,
  );
  const unjoined = roomProgression(mapSpecSchema.parse({ mapId: "m", rooms: shifted }));
  assert.equal(unjoined.get("c"), 0);
  assert.equal(unjoined.get("b"), 0);
  const unspawned = rowDoors.map((room) => ({ ...room, spawn: false }));
  const noSpawn = roomProgression(mapSpecSchema.parse({ mapId: "m", rooms: unspawned }));
  assert.deepEqual([...noSpawn.values()], [0, 0, 0, 0]);
});

await test("a factor runs from 1 at progression 0 to the value at the deepest room", () => {
  assert.equal(progressionFactor(0, 0.6), 1);
  assert.equal(progressionFactor(1, 2), 2);
});
