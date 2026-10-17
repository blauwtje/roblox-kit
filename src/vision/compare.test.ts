import assert from "node:assert/strict";
import { test } from "node:test";
import { compareAnalyses, findingsTable } from "./compare.ts";
import { extractPalette } from "./palette.ts";
import { measureValueStructure } from "./value-structure.ts";
import { segmentRegions } from "./regions.ts";
import { heuristicDepthGrid } from "./heuristic-depth.ts";
import type { RgbaImage } from "./encode-png.ts";
import type { ImageAnalysis } from "./text-tables.ts";

const grid = { columns: 4, rows: 4 };

function solid(color: number[], horizonRow = 20): ImageAnalysis {
  const size = { width: 32, height: 32 };
  const data = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) data.set([...color, 255], i * 4);
  const image: RgbaImage = { ...size, data };
  return {
    label: "solid",
    ...size,
    grid,
    palette: extractPalette(image, 3),
    value: measureValueStructure(image, grid),
    regions: segmentRegions(image, grid),
    horizon: { horizonRow, pitchDegrees: 0, confidence: 1 },
    depth: heuristicDepthGrid(size, horizonRow),
  };
}

function depthDelta(a: ImageAnalysis, truth: number[][]): number {
  const found = compareAnalyses(a, a, truth).deltas.find((d) => d.metric === "depthDelta");
  return found?.delta ?? NaN;
}

await test("identical analyses have zero palette, value and depth deltas", () => {
  const a = solid([200, 60, 50]);
  const result = compareAnalyses(a, a);
  for (const { metric, delta } of result.deltas) {
    if (metric !== "layoutDelta") assert.ok(delta < 0.01, `${metric} ${String(delta)}`);
  }
  assert.equal(result.suggestedCamera.pitchChangeDegrees, 0);
});

await test("a dark capture against a light reference ranks value and palette high", () => {
  const result = compareAnalyses(solid([230, 230, 220]), solid([20, 20, 30]));
  const byMetric = Object.fromEntries(result.deltas.map((d) => [d.metric, d.delta]));
  assert.ok((byMetric["valueDelta"] ?? 0) > 0.5);
  assert.ok((byMetric["paletteDelta"] ?? 0) > 0.5);
  assert.deepEqual(
    result.deltas.map((d) => d.delta),
    result.deltas.map((d) => d.delta).sort((x, y) => y - x),
  );
  assert.ok(result.findings.length <= 8);
  assert.equal(findingsTable(result.findings).split("\n").length, result.findings.length + 1);
});

await test("truth distances that follow the depth give a small depthDelta, reversed a large one", () => {
  const a = solid([100, 100, 100]);
  const near = a.depth.cells.map((row) => row.map((level) => level * 10 + 1));
  const far = near.map((row) => row.map((d) => 1000 - d));
  assert.ok(depthDelta(a, near) < 0.1);
  assert.ok(depthDelta(a, far) > 0.9);
});

await test("a higher capture horizon gives a pitch change and mismatched grids throw", () => {
  const reference = solid([1, 2, 3]);
  const capture = {
    ...solid([1, 2, 3]),
    horizon: { horizonRow: 8, pitchDegrees: 10, confidence: 1 },
  };
  assert.equal(compareAnalyses(reference, capture).suggestedCamera.pitchChangeDegrees, -10);
  assert.throws(() => compareAnalyses(reference, { ...capture, grid: { columns: 5, rows: 5 } }));
});
