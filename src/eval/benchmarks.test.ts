import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { config } from "../config.ts";
import { layoutMap } from "../map/map-layout.ts";
import { mapSpecSchema, relationMapSpecSchema } from "../map/map-spec.ts";
import { placeProps } from "../map/prop-placement.ts";
import { resolveRelations } from "../map/relation-solver.ts";
import { findSizeRuleIssues } from "../map/size-rules.ts";
import { loadPresets } from "../style/load-preset.ts";
import { resolveStyle } from "../style/resolve-style.ts";

const planBudgetMilliseconds = 500;

const benchmarkDirectory = new URL("../../eval/benchmarks/", import.meta.url);
const files = (await readdir(benchmarkDirectory)).filter((name) => name.endsWith(".json")).sort();

const presets = await loadPresets();

async function readBenchmark(file: string) {
  const url = new URL(file, benchmarkDirectory);
  const source: unknown = JSON.parse(await readFile(url, "utf8"));
  return relationMapSpecSchema.parse(source);
}

for (const file of files) {
  await test(`${file} parses, plans in budget, lays out, and puts a prop in every room`, async () => {
    const spec = await readBenchmark(file);
    assert.ok(spec.style);
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
    const style = resolveStyle(presets, spec.style);
    const plan = () => {
      const resolved = mapSpecSchema.parse(resolveRelations(spec));
      const layout = layoutMap(resolved, style.surfaces, { ceilings: true });
      return {
        resolved,
        layout,
        props: placeProps(resolved, style.propKit, spec.seed ?? config.defaultSeed),
      };
    };
    const times: number[] = [];
    let planned = plan();
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now();
      planned = plan();
      times.push(performance.now() - start);
    }
    assert.ok(Math.min(...times) < planBudgetMilliseconds, `plan times ${times.join(", ")} ms`);
    assert.equal(
      planned.resolved.rooms.length,
      2 * spec.rooms.length - 1,
      "one hallway per relation",
    );
    assert.ok(planned.layout.parts.length > 0);
    for (const room of planned.resolved.rooms.filter((candidate) =>
      spec.rooms.some((named) => named.name === candidate.name),
    )) {
      const inside = planned.props.some(
        (prop) =>
          Math.abs(prop.pivot.x - room.x) < room.width / 2 &&
          Math.abs(prop.pivot.z - room.z) < room.depth / 2,
      );
      assert.ok(inside, `room ${room.name} has no prop`);
    }
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
