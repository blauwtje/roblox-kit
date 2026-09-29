import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { mapSpecSchema, relationMapSpecSchema } from "./map-spec.ts";

const room = { name: "hall", x: 0, z: 0, width: 20, depth: 20 };
const minimalSpec = { mapId: "m", rooms: [room] };

await test("a spec without style or seed parses with both absent", () => {
  const spec = mapSpecSchema.parse(minimalSpec);
  assert.equal(spec.style, undefined);
  assert.equal(spec.seed, undefined);
});

await test("a spec keeps its style selection, overrides and seed", () => {
  const spec = mapSpecSchema.parse({
    ...minimalSpec,
    seed: 42,
    style: { preset: "cozy-town", overrides: { sizeRules: { minDoorwayWidth: 8 } } },
  });
  assert.equal(spec.seed, 42);
  assert.ok(spec.style);
  assert.equal(spec.style.preset, "cozy-town");
  assert.deepEqual(spec.style.overrides, { sizeRules: { minDoorwayWidth: 8 } });
});

await test("a style needs a preset name and rejects unknown keys or out-of-range overrides", () => {
  assert.throws(() => mapSpecSchema.parse({ ...minimalSpec, style: {} }));
  assert.throws(() => mapSpecSchema.parse({ ...minimalSpec, style: { preset: "" } }));
  assert.throws(() => mapSpecSchema.parse({ ...minimalSpec, style: { preset: "a", extra: 1 } }));
  assert.throws(() =>
    mapSpecSchema.parse({
      ...minimalSpec,
      style: { preset: "a", overrides: { lighting: { Atmosphere: { Density: 2 } } } },
    }),
  );
});

await test("a seed is a nonnegative integer", () => {
  for (const seed of [-1, 1.5, "1"]) {
    assert.throws(() => mapSpecSchema.parse({ ...minimalSpec, seed }));
  }
  assert.equal(mapSpecSchema.parse({ ...minimalSpec, seed: 0 }).seed, 0);
});

const relation = { to: "hall", direction: "east", hallwayLength: 10, hallwayWidth: 10 };
const relatedRoom = { name: "vault", width: 20, depth: 20, relation };

await test("a room takes x and z or a relation", () => {
  const spec = relationMapSpecSchema.parse({ mapId: "m", rooms: [room, relatedRoom] });
  const [placed, related] = spec.rooms;
  assert.ok(placed && "x" in placed);
  assert.ok(related && "relation" in related);
  assert.deepEqual(related.relation, relation);
});

await test("a room with both x/z and a relation, or only one of x and z, is rejected", () => {
  for (const rooms of [
    [{ ...room, relation }],
    [{ name: "a", x: 1, width: 20, depth: 20 }],
    [{ name: "a", z: 1, width: 20, depth: 20 }],
    [{ name: "a", width: 20, depth: 20 }],
  ]) {
    assert.equal(relationMapSpecSchema.safeParse({ mapId: "m", rooms }).success, false);
  }
});

await test("a relation needs a target, a side and positive hallway sizes", () => {
  const bad = [
    { ...relation, to: "" },
    { ...relation, direction: "up" },
    { ...relation, hallwayLength: 0 },
    { ...relation, hallwayWidth: -1 },
    { ...relation, extra: 1 },
    { to: "hall", direction: "east", hallwayLength: 10 },
  ];
  for (const badRelation of bad) {
    const rooms = [room, { ...relatedRoom, relation: badRelation }];
    assert.equal(relationMapSpecSchema.safeParse({ mapId: "m", rooms }).success, false);
  }
});

await test("relation specs keep room names unique, and the placed-only schema rejects relations", () => {
  const duplicate = relationMapSpecSchema.safeParse({
    mapId: "m",
    rooms: [room, { ...relatedRoom, name: "hall" }],
  });
  assert.equal(duplicate.success, false);
  assert.equal(mapSpecSchema.safeParse({ mapId: "m", rooms: [relatedRoom] }).success, false);
});

await test("a spec without objectives keeps them absent and gets the config performance budget", () => {
  const spec = mapSpecSchema.parse(minimalSpec);
  assert.equal(spec.objectives, undefined);
  assert.deepEqual(spec.performanceBudget, {
    maxDrawCalls: config.maxDrawCalls,
    maxTriangles: config.maxTriangles,
  });
  assert.equal(config.maxDrawCalls, 1000);
  assert.equal(config.maxTriangles, 1_000_000);
});

await test("a spec keeps its objectives and a partial performance budget fills from config", () => {
  const objectives = [{ name: "flag", x: 1, y: 2, z: 3 }];
  const spec = relationMapSpecSchema.parse({
    ...minimalSpec,
    objectives,
    performanceBudget: { maxDrawCalls: 500 },
  });
  assert.deepEqual(spec.objectives, objectives);
  assert.deepEqual(spec.performanceBudget, {
    maxDrawCalls: 500,
    maxTriangles: config.maxTriangles,
  });
});

await test("objectives and the performance budget reject bad shapes", () => {
  const badObjectives = [
    [{ name: "", x: 0, y: 0, z: 0 }],
    [{ name: "a", x: 0, y: 0 }],
    [{ name: "a", x: 0, y: 0, z: 0, extra: 1 }],
  ];
  for (const objectives of badObjectives) {
    assert.throws(() => mapSpecSchema.parse({ ...minimalSpec, objectives }));
  }
  for (const performanceBudget of [
    { maxDrawCalls: 0 },
    { maxTriangles: -1 },
    { maxDrawCalls: 1.5 },
    { extra: 1 },
  ]) {
    assert.throws(() => mapSpecSchema.parse({ ...minimalSpec, performanceBudget }));
  }
});
