import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededRandom } from "./seeded-random.ts";

function drawValues(seed: number, count: number): number[] {
  const random = createSeededRandom(seed);
  return Array.from({ length: count }, () => random());
}

await test("the same seed yields the same sequence", () => {
  assert.deepEqual(drawValues(42, 20), drawValues(42, 20));
});

await test("different seeds yield different sequences", () => {
  assert.notDeepEqual(drawValues(1, 20), drawValues(2, 20));
});

await test("every value is a float in [0, 1)", () => {
  for (const value of drawValues(7, 1000)) {
    assert.ok(value >= 0 && value < 1, `value ${String(value)} is out of range`);
  }
});

await test("values are spread across the range", () => {
  const values = drawValues(123, 1000);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(mean > 0.4 && mean < 0.6, `mean ${String(mean)} is not near 0.5`);
});

await test("non-integer and negative seeds still give in-range values", () => {
  for (const seed of [-5, 3.7, 2 ** 40]) {
    for (const value of drawValues(seed, 50)) {
      assert.ok(value >= 0 && value < 1);
    }
  }
});
