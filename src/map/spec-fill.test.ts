import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPresets } from "../style/load-preset.ts";
import { relationMapSpecSchema } from "./map-spec.ts";
import { fillDefaults, fillMapSpec } from "./spec-fill.ts";

const presets = await loadPresets();
const presetName = [...presets.keys()].find((name) => presets.get(name)?.roomTypes !== undefined);
assert.ok(presetName);
const preset = presets.get(presetName);
assert.ok(preset);
const roomTypes = Object.keys(preset.roomTypes ?? {});

const base = {
  terrain: [],
  clutter: false,
  signage: false,
  motion: false,
  performanceBudget: { maxDrawCalls: 1, maxTriangles: 1 },
};

await test("a style alone fills mapId and one room per room type", () => {
  const { spec, fills } = fillMapSpec({ ...base, style: { preset: presetName } }, presets);
  assert.equal(spec.mapId, presetName);
  assert.deepEqual(
    spec.rooms.map((room) => room.name),
    roomTypes,
  );
  assert.equal(fills.length, 2);
  const [first, second] = spec.rooms;
  assert.ok(first && "x" in first && first.spawn);
  if (roomTypes.length > 1) {
    assert.ok(second && "relation" in second);
    assert.equal(second.relation.to, roomTypes[0]);
    assert.equal(second.relation.direction, "east");
    assert.equal(second.relation.hallwayWidth, preset.sizeRules.minHallwayWidth);
    assert.equal(second.wallHeight, preset.sizeRules.minWallHeight);
    assert.equal(second.width, fillDefaults.roomWidth);
  }
  assert.equal(spec.clutter, false);
  assert.equal("npcs" in spec, false);
});

await test("the filled spec passes the relation schema", () => {
  const { spec } = fillMapSpec({ ...base, style: { preset: presetName } }, presets);
  assert.ok(relationMapSpecSchema.safeParse(spec).success);
});

await test("a full spec passes unchanged with no fills", () => {
  const input = {
    ...base,
    mapId: "m",
    rooms: [{ name: "a", width: 10, depth: 10, x: 0, z: 0, doors: [], spawn: true }],
  };
  const result = fillMapSpec(input, presets);
  assert.equal(result.spec.mapId, "m");
  assert.equal(result.spec.rooms, input.rooms);
  assert.deepEqual(result.fills, []);
});

await test("neither style nor rooms throws listing the preset names", () => {
  assert.throws(() => fillMapSpec(base, presets), new RegExp(presetName));
});

await test("preset and room type names match ignoring case, spaces and hyphens", () => {
  const messy = presetName.toUpperCase().replaceAll("-", "  ");
  const [type] = roomTypes;
  assert.ok(type);
  const room = { name: "a", width: 10, depth: 10, x: 0, z: 0, doors: [], spawn: true };
  const { spec } = fillMapSpec(
    {
      ...base,
      style: { preset: messy },
      rooms: [{ ...room, roomType: ` ${type.toUpperCase()} ` }],
    },
    presets,
  );
  assert.equal(spec.style.preset, presetName);
  assert.equal(spec.rooms[0]?.roomType, type);
  assert.throws(
    () =>
      fillMapSpec(
        { ...base, style: { preset: presetName }, rooms: [{ ...room, roomType: "nowhere" }] },
        presets,
      ),
    /Unknown room type "nowhere"/,
  );
});
