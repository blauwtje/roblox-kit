import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import {
  drawSprite,
  recordedSprites,
  spriteHashes,
  spriteKind,
  spriteSizePixels,
} from "../lighting/ambient-sprites.ts";
import { spriteNames, type AmbientEffect } from "../style/preset-schema.ts";
import { config } from "../config.ts";
import { ambientEffectsOf, missingSpriteWarnings } from "./ambient-effects.ts";
import { layoutMap } from "./map-layout.ts";
import { mapSpecSchema } from "./map-spec.ts";

const spec = mapSpecSchema.parse({
  mapId: "ambient",
  rooms: [
    { name: "hall", x: 0, z: 0, width: 40, depth: 40, roomType: "concourse" },
    { name: "side", x: 40, z: 0, width: 20, depth: 20 },
  ],
});
const layout = layoutMap(spec);
const base = { color: "#ffffff", heightStuds: 6, transparency: 0.5, lightEmission: 0.2 };
const effects: AmbientEffect[] = [
  {
    ...base,
    kind: "particles",
    name: "dust",
    sprite: "dust",
    rate: 4,
    lifetimeSeconds: 6,
    sizeStuds: 0.3,
    speedStuds: 0.5,
  },
  { ...base, kind: "beam", name: "shaft", sprite: "glow", roomTypes: ["concourse"], widthStuds: 6 },
];

await test("particles go in every room and a typed beam only in rooms of its type", () => {
  const records = ambientEffectsOf(spec, layout.parts, effects, {});
  assert.deepEqual(
    records.map((record) => `${record.zone}:${record.name}`),
    ["hall:dust", "hall:shaft", "side:dust"],
  );
  const floor = layout.parts.find((part) => part.kind === "floor" && part.room === "hall");
  assert.ok(floor);
  const top = floor.position.y + floor.size.y / 2;
  const [dust, shaft] = records;
  assert.ok(dust && shaft);
  assert.deepEqual(dust.position, { x: floor.position.x, y: top + 6, z: floor.position.z });
  assert.equal(dust.part, floor.name);
  assert.equal(shaft.position.x, floor.position.x - (floor.size.x / 2 - 2));
  assert.equal(shaft.endPosition?.x, floor.position.x + (floor.size.x / 2 - 2));
  assert.ok(records.every((record) => record.texture === undefined));
});

await test("scales particle rates together when the alive particles pass the map cap", () => {
  const dense: AmbientEffect[] = effects.map((effect) =>
    effect.kind === "particles" ? { ...effect, rate: 100, lifetimeSeconds: 10 } : effect,
  );
  const records = ambientEffectsOf(spec, layout.parts, dense, {});
  let alive = 0;
  for (const record of records) {
    if (record.kind === "particles") alive += record.rate * record.lifetimeSeconds;
  }
  assert.ok(Math.abs(alive - config.maxAliveParticlesPerMap) < 1e-9);
  const rates = records.flatMap((record) => (record.kind === "particles" ? [record.rate] : []));
  assert.equal(new Set(rates).size, 1);
  assert.ok(rates[0] !== undefined && rates[0] < 100);
});

await test("keeps particle rates under the cap as they are", () => {
  const records = ambientEffectsOf(spec, layout.parts, effects, {});
  const dust = records.find((record) => record.kind === "particles");
  assert.equal(dust?.kind === "particles" ? dust.rate : undefined, 4);
});

await test("a recorded sprite gives its emitters a texture and no warning", () => {
  const textures = { dust: "rbxassetid://123" };
  const records = ambientEffectsOf(spec, layout.parts, effects, textures);
  assert.equal(records[0]?.texture, "rbxassetid://123");
  assert.equal(records[1]?.texture, undefined);
  const warnings = missingSpriteWarnings(effects, textures);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /"glow".*untextured/);
});

await test("every sprite is a square RGBA PNG with a soft alpha shape", () => {
  for (const sprite of spriteNames) {
    const png = drawSprite(sprite);
    assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
    assert.equal(png.readUInt32BE(16), spriteSizePixels);
    assert.equal(png.readUInt32BE(20), spriteSizePixels);
    const idatLength = png.readUInt32BE(33);
    const rows = inflateSync(png.subarray(41, 41 + idatLength));
    const alphas = [];
    for (let y = 0; y < spriteSizePixels; y++) {
      for (let x = 0; x < spriteSizePixels; x++) {
        alphas.push(rows[y * (1 + spriteSizePixels * 4) + 1 + x * 4 + 3] ?? 0);
      }
    }
    assert.equal(alphas[0], 0, `${sprite} corner is transparent`);
    assert.ok(Math.max(...alphas) > 200, `${sprite} has an opaque center`);
    assert.deepEqual(drawSprite(sprite), png, `${sprite} draws the same twice`);
  }
});

await test("recorded sprites are read by hash and kind from the given file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sprites-"));
  const file = pathToFileURL(join(directory, "assets.json"));
  const hashes = await spriteHashes();
  assert.equal(new Set(Object.values(hashes)).size, spriteNames.length);
  await writeFile(
    file,
    JSON.stringify({
      [hashes.dust]: { kind: spriteKind("dust"), assetId: "42" },
      [hashes.spark]: { kind: "prop-lamp", assetId: "7" },
    }),
  );
  assert.deepEqual(await recordedSprites(file), { dust: "rbxassetid://42" });
  assert.deepEqual(await recordedSprites(pathToFileURL(join(directory, "none.json"))), {});
});
