import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { config } from "../config.ts";
import { layoutMap } from "../map/map-layout.ts";
import { mapSpecSchema, relationMapSpecSchema } from "../map/map-spec.ts";
import { placeProps } from "../map/prop-placement.ts";
import { resolveRelations } from "../map/relation-solver.ts";
import { findSizeRuleIssues } from "../map/size-rules.ts";
import { loadPresets } from "../style/load-preset.ts";
import { resolveStyle } from "../style/resolve-style.ts";

const benchmarks = [
  { file: "train-station.json", preset: "train-station", roomCount: 3 },
  { file: "horror-facility-wing.json", preset: "horror-facility", roomCount: 4 },
  { file: "sci-fi-kitchen.json", preset: "sci-fi-station", roomCount: 3 },
];

const presets = await loadPresets();

async function readBenchmark(file: string) {
  const url = new URL(`../../eval/benchmarks/${file}`, import.meta.url);
  const source: unknown = JSON.parse(await readFile(url, "utf8"));
  return relationMapSpecSchema.parse(source);
}

for (const { file, preset, roomCount } of benchmarks) {
  await test(`${file} parses, names its preset and places rooms by relation`, async () => {
    const spec = await readBenchmark(file);
    assert.equal(spec.style?.preset, preset);
    assert.equal(spec.rooms.length, roomCount);
    assert.ok(spec.seed !== undefined);
    assert.ok(
      spec.rooms.some((room) => "x" in room),
      "one room anchors the map",
    );
    assert.ok(
      spec.rooms.some((room) => "relation" in room),
      "other rooms use relations",
    );
    assert.ok(
      spec.rooms.some((room) => room.spawn),
      "the map has a spawn",
    );
  });

  await test(`${file} resolves to a placed spec that lays out, gets props and meets the size rules`, async () => {
    const spec = await readBenchmark(file);
    assert.ok(spec.style);
    const resolved = mapSpecSchema.parse(resolveRelations(spec));
    assert.equal(resolved.rooms.length, 2 * spec.rooms.length - 1, "one hallway per relation");
    const style = resolveStyle(presets, spec.style);
    assert.ok(layoutMap(resolved, style.surfaces, { ceilings: true }).parts.length > 0);
    assert.ok(placeProps(resolved, style.propKit, spec.seed ?? config.defaultSeed).length > 0);
    assert.deepEqual(findSizeRuleIssues(spec, style.sizeRules, spec.mapId), []);
  });

  await test(`${file} puts every objective inside a room`, async () => {
    const spec = await readBenchmark(file);
    const resolved = resolveRelations(spec);
    assert.ok((spec.objectives ?? []).length > 0);
    for (const objective of spec.objectives ?? []) {
      const inside = resolved.rooms.some(
        (room) =>
          Math.abs(objective.x - room.x) < room.width / 2 &&
          Math.abs(objective.z - room.z) < room.depth / 2,
      );
      assert.ok(inside, `objective ${objective.name} lies outside every room`);
    }
  });
}

await test("the benchmarks use distinct map ids and seeds", async () => {
  const specs = await Promise.all(benchmarks.map(({ file }) => readBenchmark(file)));
  assert.equal(new Set(specs.map((spec) => spec.mapId)).size, specs.length);
  assert.equal(new Set(specs.map((spec) => spec.seed)).size, specs.length);
});
