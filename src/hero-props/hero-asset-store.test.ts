import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { heroAssetsFile, readHeroAssets, recordHeroAsset } from "./hero-asset-store.ts";

async function tempFile(): Promise<URL> {
  const directory = await mkdtemp(join(tmpdir(), "hero-assets-"));
  return pathToFileURL(join(directory, "hero-assets.json"));
}

await test("the committed record parses to a kind and numeric asset id per hash", async () => {
  for (const [hash, record] of Object.entries(await readHeroAssets(heroAssetsFile))) {
    assert.match(hash, /^[0-9a-f]+$/);
    assert.ok(record.kind.length > 0, `${hash} has no kind`);
    assert.match(record.assetId, /^\d+$/);
  }
});

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
