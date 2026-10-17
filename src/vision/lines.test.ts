import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateHorizon } from "./lines.ts";

function wedges(size: number, vanishingRow: number): Float32Array {
  const data = new Float32Array(size * size);
  const centerX = (size - 1) / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const angle = Math.atan2(y - vanishingRow, x - centerX);
      data[y * size + x] = Math.floor(angle / (Math.PI / 12)) % 2 === 0 ? 0 : 1;
    }
  return data;
}

await test("lines converging on a row put the horizon there", () => {
  const estimate = estimateHorizon(wedges(96, 30), { width: 96, height: 96 });
  assert.ok(Math.abs(estimate.horizonRow - 30) < 4, String(estimate.horizonRow));
  assert.ok(estimate.pitchDegrees > 0);
  assert.ok(estimate.confidence > 0.3);
});

await test("a flat image has no horizon evidence", () => {
  const flat = new Float32Array(32 * 32).fill(0.5);
  assert.deepEqual(estimateHorizon(flat, { width: 32, height: 32 }), {
    horizonRow: 16,
    pitchDegrees: 0,
    confidence: 0,
  });
});

await test("a horizon below the center pitches the camera down", () => {
  const estimate = estimateHorizon(wedges(96, 70), { width: 96, height: 96 });
  assert.ok(estimate.pitchDegrees < 0);
});
