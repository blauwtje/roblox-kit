import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { loadPresets } from "../style/load-preset.ts";
import { materialMapNames } from "../style/preset-schema.ts";
import {
  heroAssetsFile,
  materialMapHashes,
  pruneHeroAssets,
  readHeroAssets,
  reachableHeroHashes,
  recordHeroAsset,
  recordedMaterialMaps,
} from "./hero-asset-store.ts";
import { heroRecipeHash } from "./hero-prop-asset.ts";

async function tempFile(): Promise<URL> {
  const directory = await mkdtemp(join(tmpdir(), "hero-assets-"));
  return pathToFileURL(join(directory, "hero-assets.json"));
}

await test("a missing file reads as no assets", async () => {
  assert.deepEqual(await readHeroAssets(await tempFile()), {});
});

await test("recordHeroAsset keeps earlier entries and replaces the same hash", async () => {
  const file = await tempFile();
  await recordHeroAsset("aaa", { kind: "train-car", assetId: "111" }, file);
  await recordHeroAsset("bbb", { kind: "ticket-counter", assetId: "222" }, file);
  await recordHeroAsset("aaa", { kind: "train-car", assetId: "333" }, file);
  assert.deepEqual(await readHeroAssets(file), {
    aaa: { kind: "train-car", assetId: "333" },
    bbb: { kind: "ticket-counter", assetId: "222" },
  });
  assert.match(await readFile(file, "utf8"), /\n$/);
});

await test("recordHeroAsset refuses a non-numeric asset id", async () => {
  const file = await tempFile();
  await assert.rejects(recordHeroAsset("aaa", { kind: "train-car", assetId: "abc" }, file));
  assert.deepEqual(await readHeroAssets(file), {});
});

await test("a malformed record is an error, not an empty record", async () => {
  const file = await tempFile();
  await writeFile(file, '{"aaa":{"kind":"train-car"}}');
  await assert.rejects(readHeroAssets(file));
});

const brick = { pattern: "brick", seed: 1, roughness: 0.8, metalness: 0, studsPerTile: 8 } as const;

await test("materialMapHashes names every map and ignores studsPerTile", async () => {
  const hashes = await materialMapHashes(brick);
  assert.deepEqual(Object.keys(hashes), [...materialMapNames]);
  assert.deepEqual(await materialMapHashes({ ...brick, studsPerTile: 4 }), hashes);
  assert.notDeepEqual(await materialMapHashes({ ...brick, seed: 2 }), hashes);
});

await test("recordedMaterialMaps finds a map only under its hash and its own kind", async () => {
  const file = await tempFile();
  const hashes = await materialMapHashes(brick);
  await recordHeroAsset(hashes.color, { kind: "material-color", assetId: "11" }, file);
  await recordHeroAsset(hashes.normal, { kind: "train-car", assetId: "12" }, file);
  const { recorded } = await recordedMaterialMaps(brick, file);
  assert.deepEqual(recorded, { color: "11" });
});

await test("every committed preset's variant maps are the recorded uploads of its material recipe", async () => {
  for (const [name, preset] of await loadPresets()) {
    for (const [role, surface] of Object.entries(preset.surfaces)) {
      const maps = surface.variant?.maps;
      if (maps === undefined) continue;
      assert.ok(surface.texture, `${name} ${role} has maps but no material recipe`);
      const { recorded } = await recordedMaterialMaps(surface.texture);
      for (const map of materialMapNames) {
        assert.equal(
          maps[map],
          `rbxassetid://${String(recorded[map])}`,
          `${name} ${role} ${map} is not the recorded upload of its recipe; run npm run materials -- ${name}`,
        );
      }
    }
  }
});

await test("every declared hero prop and mesh hash is recorded and no record is unreachable", async () => {
  const presets = await loadPresets();
  const assets = await readHeroAssets(heroAssetsFile);
  for (const [name, preset] of presets) {
    const kinds = [...Object.keys(preset.heroProps ?? {}), ...Object.keys(preset.meshes ?? {})];
    for (const kind of kinds) {
      const hash = await heroRecipeHash(preset, kind);
      assert.equal(assets[hash]?.kind, kind, `${name} ${kind} ${hash} has no record`);
    }
  }
  const reachable = await reachableHeroHashes(presets);
  const unreachable = Object.keys(assets).filter((hash) => !reachable.has(hash));
  assert.deepEqual(unreachable, [], "run: node scripts/hero-props.ts prune");
});

await test("pruneHeroAssets lists the unreachable records and drops them unless dry", async () => {
  const file = await tempFile();
  await recordHeroAsset("aaa", { kind: "train-car", assetId: "1" }, file);
  await recordHeroAsset("bbb", { kind: "train-car", assetId: "2" }, file);
  const reachable = new Map([["aaa", "train-car"]]);
  assert.deepEqual(await pruneHeroAssets(reachable, true, file), ["bbb"]);
  assert.deepEqual(Object.keys(await readHeroAssets(file)), ["aaa", "bbb"]);
  assert.deepEqual(await pruneHeroAssets(reachable, false, file), ["bbb"]);
  assert.deepEqual(Object.keys(await readHeroAssets(file)), ["aaa"]);
});
