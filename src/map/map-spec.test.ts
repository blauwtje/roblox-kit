import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSpecSchema } from "./map-spec.ts";

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
