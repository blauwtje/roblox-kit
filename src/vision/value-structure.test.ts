import assert from "node:assert/strict";
import { test } from "node:test";
import type { RgbaImage } from "./encode-png.ts";
import { gridCellName, measureValueStructure } from "./value-structure.ts";

function halves(): RgbaImage {
  const data = new Uint8Array(20 * 10 * 4);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 20; x++)
      data.set(x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * 20 + x) * 4);
  }
  return { width: 20, height: 10, data };
}

await test("cells are named A1 onward, columns as letters", () => {
  assert.equal(gridCellName(0, 0), "A1");
  assert.equal(gridCellName(2, 1), "C2");
  assert.equal(gridCellName(26, 0), "AA1");
});

await test("a black and white image fills the end bins and tones", () => {
  const result = measureValueStructure(halves(), { columns: 2, rows: 1 });
  assert.equal(result.histogram.length, 8);
  assert.ok(Math.abs((result.histogram[0] ?? 0) - 0.5) < 1e-9);
  assert.ok(Math.abs((result.histogram[7] ?? 0) - 0.5) < 1e-9);
  assert.ok(
    Math.abs(result.tones.shadows - 0.5) < 1e-9 && Math.abs(result.tones.lights - 0.5) < 1e-9,
  );
  assert.deepEqual(
    result.cells.map((cell) => cell.name),
    ["A1", "B1"],
  );
  assert.ok((result.cells[0]?.lightness ?? 1) < 0.01);
  assert.ok((result.cells[1]?.lightness ?? 0) > 0.99);
});
