import assert from "node:assert/strict";
import { test } from "node:test";
import { regionEdgeStats } from "./edges.ts";

function plane(width: number, height: number, value: (x: number, y: number) => number) {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data[y * width + x] = value(x, y);
  return data;
}
const whole = { left: 0, top: 0, right: 20, bottom: 20 };

await test("a flat plane has no edges", () => {
  const stats = regionEdgeStats(
    plane(20, 20, () => 0.5),
    { width: 20, height: 20 },
    whole,
  );
  assert.deepEqual(stats, { edgeDensity: 0, edgeAngle: null });
});

await test("a vertical step edge reads as a 90 degree line", () => {
  const stats = regionEdgeStats(
    plane(20, 20, (x) => (x < 10 ? 0 : 1)),
    { width: 20, height: 20 },
    whole,
  );
  assert.ok(Math.abs((stats.edgeAngle ?? -1) - 90) < 1);
  assert.ok(stats.edgeDensity > 0.05 && stats.edgeDensity < 0.3);
});

await test("a horizontal step edge reads as a 0 degree line", () => {
  const stats = regionEdgeStats(
    plane(20, 20, (_x, y) => (y < 10 ? 0 : 1)),
    { width: 20, height: 20 },
    whole,
  );
  const angle = stats.edgeAngle ?? -1;
  assert.ok(Math.min(angle, 180 - angle) < 1);
});
