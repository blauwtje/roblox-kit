import assert from "node:assert/strict";
import { test } from "node:test";
import { heuristicDepthGrid } from "./heuristic-depth.ts";

const size = { width: 80, height: 80 };

await test("the grid is labelled heuristic with levels from 0 to 9", () => {
  const grid = heuristicDepthGrid(size, 30);
  assert.equal(grid.source, "heuristic");
  assert.equal(grid.cells.length, grid.rows);
  assert.equal(grid.cells[0]?.length, grid.columns);
  for (const level of grid.cells.flat())
    assert.ok(Number.isInteger(level) && level >= 0 && level <= 9);
});

await test("rows above the horizon are farthest and the bottom row is nearest", () => {
  const grid = heuristicDepthGrid(size, 30);
  assert.equal(grid.cells[0]?.[0], 9);
  assert.equal(grid.cells[grid.rows - 1]?.[0], 0);
});

await test("depth never decreases going up the image", () => {
  const column = heuristicDepthGrid(size, 30).cells.map((row) => row[0] ?? -1);
  for (let i = 1; i < column.length; i++) assert.ok((column[i - 1] ?? 0) >= (column[i] ?? 0));
});
