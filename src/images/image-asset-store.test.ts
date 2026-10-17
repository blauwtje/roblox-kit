import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { readImageAssets, uploadCachedImage } from "./image-asset-store.ts";

const credentials = { apiKey: "k", creator: { userId: "42" } };
const fast = { moderationPollIntervalMs: 0, moderationMaxPolls: 3 };

function pngOf(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const json = (value: unknown): Response => Response.json(value);
const uploaded = (): Response =>
  json({ operationId: "op", done: true, response: { assetId: "555" } });
const state = (moderationState: string): Response =>
  json({ moderationResult: { moderationState } });

function fakeFetch(responses: Response[]): { fetchFn: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn: typeof fetch = (input) => {
    urls.push(new Request(input).url);
    const next = responses.shift();
    return next === undefined
      ? Promise.reject(new Error("unexpected extra fetch"))
      : Promise.resolve(next);
  };
  return { fetchFn, urls };
}

async function tempFile(): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), "image-assets-"));
  return pathToFileURL(join(dir, "image-assets.json"));
}

await test("an approved upload is recorded and the same bytes then return the id with no fetch", async () => {
  const assetsFile = await tempFile();
  const fake = fakeFetch([
    uploaded(),
    state("MODERATION_STATE_PENDING"),
    state("MODERATION_STATE_APPROVED"),
  ]);
  const png = pngOf(8, 8);
  const first = await uploadCachedImage({
    png: png,
    name: "sign",
    kind: "signage",
    credentials,
    transport: { fetchFn: fake.fetchFn },
    assetsFile,
    ...fast,
  });
  assert.deepEqual(first, { assetId: "555", moderation: "approved" });
  const records = Object.values(await readImageAssets(assetsFile));
  assert.deepEqual(records, [{ name: "sign", kind: "signage", assetId: "555" }]);
  const again = fakeFetch([]);
  const second = await uploadCachedImage({
    png: png,
    name: "other",
    kind: "signage",
    credentials,
    transport: { fetchFn: again.fetchFn },
    assetsFile,
    ...fast,
  });
  assert.equal(second.assetId, "555");
  assert.equal(again.urls.length, 0);
});

await test("a rejected image throws and is not recorded", async () => {
  const assetsFile = await tempFile();
  const fake = fakeFetch([uploaded(), state("MODERATION_STATE_REJECTED")]);
  await assert.rejects(
    uploadCachedImage({
      png: pngOf(8, 8),
      name: "bad",
      kind: "signage",
      credentials,
      transport: { fetchFn: fake.fetchFn },
      assetsFile,
      ...fast,
    }),
    /rejected/,
  );
  assert.deepEqual(await readImageAssets(assetsFile), {});
});

await test("an image still pending after the polls returns pending and is not recorded", async () => {
  const assetsFile = await tempFile();
  const fake = fakeFetch([uploaded(), ...[1, 2, 3].map(() => state("MODERATION_STATE_PENDING"))]);
  const result = await uploadCachedImage({
    png: pngOf(8, 8),
    name: "slow",
    kind: "signage",
    credentials,
    transport: { fetchFn: fake.fetchFn },
    assetsFile,
    ...fast,
  });
  assert.deepEqual(result, { assetId: "555", moderation: "pending" });
  assert.deepEqual(await readImageAssets(assetsFile), {});
});

await test("non-PNG bytes and out-of-range sizes are refused before any fetch", async () => {
  const assetsFile = await tempFile();
  const fake = fakeFetch([]);
  const run = (bytes: Uint8Array<ArrayBuffer>) =>
    uploadCachedImage({
      png: bytes,
      name: "x",
      kind: "k",
      credentials,
      transport: { fetchFn: fake.fetchFn },
      assetsFile,
      ...fast,
    });
  await assert.rejects(run(new Uint8Array(40)), /not a PNG/);
  await assert.rejects(run(pngOf(0, 8)), /outside/);
  await assert.rejects(run(pngOf(8, 99999)), /outside/);
  assert.equal(fake.urls.length, 0);
});

await test("with a project folder the record is written under .roblox-kit and read back", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "image-project-"));
  const assetsFile = await tempFile();
  const fake = fakeFetch([uploaded(), state("MODERATION_STATE_APPROVED")]);
  await uploadCachedImage({
    png: pngOf(4, 4),
    name: "n",
    kind: "k",
    credentials,
    transport: { fetchFn: fake.fetchFn },
    assetsFile,
    projectDir,
    ...fast,
  });
  const written = JSON.parse(
    await readFile(join(projectDir, ".roblox-kit", "image-assets.json"), "utf8"),
  ) as object;
  assert.equal(Object.keys(written).length, 1);
  assert.deepEqual(await readImageAssets(assetsFile), {});
});
