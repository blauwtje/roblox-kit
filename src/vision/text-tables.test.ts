import assert from "node:assert/strict";
import { test } from "node:test";
import { paletteTable, colorFromRgb, depthTable, horizonLine } from "./text-tables.ts";
import type { PaletteColor } from "./palette.ts";

const red: PaletteColor = {
  share: 0.5,
  srgbHex: "#ff0000",
  color3: [1, 0, 0],
  oklab: { l: 0.628, a: 0.225, b: 0.126 },
  lightness: 0.628,
  chroma: 0.258,
  hueDegrees: 29,
  materialGuess: "Brick",
};

await test("a palette row gives the Color3.fromRGB integers and the share", () => {
  assert.deepEqual(colorFromRgb(red), [255, 0, 0]);
  const [header, row] = paletteTable([red]).split("\n");
  assert.ok(header?.startsWith("# | share"));
  assert.match(row ?? "", /50\.0% \| #ff0000 \| \(255, 0, 0\)/);
});

await test("the horizon and depth tables name their numbers and source", () => {
  assert.match(
    horizonLine({ horizonRow: 100.4, pitchDegrees: -3.25, confidence: 0.5 }),
    /horizon row 100, pitch -3\.3 degrees, confidence 0\.50/,
  );
  const text = depthTable({
    source: "heuristic",
    columns: 2,
    rows: 2,
    cells: [
      [9, 9],
      [0, 1],
    ],
  });
  assert.match(text, /source heuristic, 2 by 2\n9 9\n0 1$/);
});
