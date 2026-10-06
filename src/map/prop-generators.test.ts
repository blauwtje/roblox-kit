import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** The train-station prop kinds whose generators read their colors and materials from preset prop slots. */
const slotKinds = [
  "ticket-machine",
  "ticket-counter",
  "clock",
  "platform-edge",
  "sign",
  "departure-board",
];

/** A color built from numbers or a hex string, a BrickColor, or the Neon material: a look a preset slot must decide. */
const hardcodedLook =
  /Color3\.(fromRGB|fromHSV|fromHex)|Color3\.new\(\s*[^)\s]|BrickColor|Enum\.Material\.Neon/;

function generatorSource(kind: string): string {
  return readFileSync(new URL(`../../luau/props/${kind}.luau`, import.meta.url), "utf8");
}

for (const kind of slotKinds) {
  await test(`the ${kind} generator hardcodes no color literal and no Neon`, () => {
    const lines = generatorSource(kind).split("\n");
    const offenders = lines.filter((line) => hardcodedLook.test(line.replace(/--.*$/, "")));
    assert.deepEqual(offenders, []);
  });

  await test(`the ${kind} generator reads a slot attribute and keeps a default for it`, () => {
    const source = generatorSource(kind);
    assert.match(source, /slotLook\(params\.Attributes, "[A-Z][a-z]+"\)/);
    const slots = [...source.matchAll(/slotLook\(params\.Attributes, "([A-Z][a-z]+)"\)/g)].map(
      (match) => match[1] ?? "",
    );
    for (const slot of slots) {
      assert.match(source, new RegExp(`\\b${slot}Color = DEFAULT_COLOR`), `${slot}Color default`);
      assert.match(
        source,
        new RegExp(`\\b${slot}Material = DEFAULT_MATERIAL`),
        `${slot}Material default`,
      );
    }
  });
}
