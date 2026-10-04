import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { readHeroAssets } from "./hero-asset-store.ts";
import { uploadGlb, uploadReviewedHeroProp } from "./open-cloud-upload.ts";

const credentials = { apiKey: "test-key", creator: { userId: "42" } };
const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);

interface FakeCall {
  url: string;
  method: string;
  apiKey: string | null;
  body: BodyInit | null | undefined;
}

/** A fetch that answers each call with the next canned response and records what was asked; no network. */
function fakeFetch(responses: Response[]): { fetchFn: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: new Request(input).url,
      method: init?.method ?? "GET",
      apiKey: headers.get("x-api-key"),
      body: init?.body,
    });
    const next = responses.shift();
    if (next === undefined) return Promise.reject(new Error("unexpected extra fetch"));
    return Promise.resolve(next);
  };
  return { fetchFn, calls };
}

const json = (value: unknown, status = 200): Response => Response.json(value, { status });
const pending = { path: "operations/op1", operationId: "op1", done: false };
const finished = { ...pending, done: true, response: { assetId: "9001" } };

await test("uploadGlb posts a multipart Model request, polls the operation and returns the asset id", async () => {
  const { fetchFn, calls } = fakeFetch([json(pending), json(pending), json(finished)]);
  const assetId = await uploadGlb(glb, "train-car-abc", credentials, {
    fetchFn,
    pollIntervalMs: 0,
  });
  assert.equal(assetId, "9001");
  assert.equal(calls.length, 3);
  const [upload, firstPoll, secondPoll] = calls as [FakeCall, FakeCall, FakeCall];
  assert.equal(upload.url, "https://apis.roblox.com/assets/v1/assets");
  assert.equal(upload.method, "POST");
  assert.equal(upload.apiKey, "test-key");
  const form = upload.body;
  assert.ok(form instanceof FormData);
  const requestField = form.get("request");
  assert.equal(typeof requestField, "string");
  const request = JSON.parse(requestField as string) as Record<string, unknown>;
  assert.equal(request.assetType, "Model");
  assert.deepEqual(request.creationContext, { creator: { userId: "42" } });
  const file = form.get("fileContent");
  assert.ok(file instanceof File);
  assert.equal(file.type, "model/gltf-binary");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), glb);
  assert.equal(firstPoll.url, "https://apis.roblox.com/assets/v1/operations/op1");
  assert.equal(firstPoll.method, "GET");
  assert.equal(firstPoll.apiKey, "test-key");
  assert.equal(secondPoll.url, firstPoll.url);
});

await test("uploadGlb returns without polling when the upload is already done", async () => {
  const { fetchFn, calls } = fakeFetch([json(finished)]);
  assert.equal(await uploadGlb(glb, "x", credentials, { fetchFn, pollIntervalMs: 0 }), "9001");
  assert.equal(calls.length, 1);
});

await test("uploadGlb fails on an HTTP error without echoing the key", async () => {
  const { fetchFn } = fakeFetch([json({ message: "forbidden" }, 403)]);
  await assert.rejects(
    uploadGlb(glb, "x", credentials, { fetchFn, pollIntervalMs: 0 }),
    (error: Error) => error.message.includes("403") && !error.message.includes("test-key"),
  );
});

await test("uploadGlb fails on a rejected upload", async () => {
  const rejected = {
    ...pending,
    done: true,
    error: { code: "INVALID_ARGUMENT", message: "bad model" },
  };
  const { fetchFn } = fakeFetch([json(pending), json(rejected)]);
  await assert.rejects(
    uploadGlb(glb, "x", credentials, { fetchFn, pollIntervalMs: 0 }),
    /INVALID_ARGUMENT.*bad model/,
  );
});

await test("uploadGlb gives up after maxPolls polls", async () => {
  const { fetchFn, calls } = fakeFetch([
    json(pending),
    json(pending),
    json(pending),
    json(pending),
  ]);
  await assert.rejects(
    uploadGlb(glb, "x", credentials, { fetchFn, pollIntervalMs: 0, maxPolls: 2 }),
    /not done after 2 polls/,
  );
  assert.equal(calls.length, 3);
});

await test("uploadGlb names a group creator in the request when the key is group-owned", async () => {
  const { fetchFn, calls } = fakeFetch([json(finished)]);
  const groupCredentials = { apiKey: "test-key", creator: { groupId: "718128661" } };
  await uploadGlb(glb, "x", groupCredentials, { fetchFn, pollIntervalMs: 0 });
  const form = calls[0]?.body;
  assert.ok(form instanceof FormData);
  const request = JSON.parse(form.get("request") as string) as Record<string, unknown>;
  assert.deepEqual(request.creationContext, { creator: { groupId: "718128661" } });
});

async function generatedFolder(review: { hash: string; passed: boolean }): Promise<{
  directory: URL;
  assetsFile: URL;
}> {
  const root = await mkdtemp(join(tmpdir(), "hero-upload-"));
  await writeFile(join(root, "model.glb"), glb);
  await writeFile(join(root, "review.json"), JSON.stringify(review));
  return {
    directory: pathToFileURL(`${root}/`),
    assetsFile: pathToFileURL(join(root, "hero-assets.json")),
  };
}

await test("uploadReviewedHeroProp uploads a passed GLB once and records hash to kind and asset id", async () => {
  const { directory, assetsFile } = await generatedFolder({ hash: "abc123", passed: true });
  const { fetchFn, calls } = fakeFetch([json(finished)]);
  const transport = { fetchFn, pollIntervalMs: 0 };
  const first = await uploadReviewedHeroProp(
    "train-car",
    "abc123",
    directory,
    credentials,
    transport,
    assetsFile,
  );
  assert.equal(first, "9001");
  assert.deepEqual(await readHeroAssets(assetsFile), {
    abc123: { kind: "train-car", assetId: "9001" },
  });
  const second = await uploadReviewedHeroProp(
    "train-car",
    "abc123",
    directory,
    credentials,
    transport,
    assetsFile,
  );
  assert.equal(second, "9001");
  assert.equal(calls.length, 1);
});

await test("uploadReviewedHeroProp refuses a failed or mismatched review without a call", async () => {
  for (const review of [
    { hash: "abc123", passed: false },
    { hash: "other", passed: true },
  ]) {
    const { directory, assetsFile } = await generatedFolder(review);
    const { fetchFn, calls } = fakeFetch([]);
    await assert.rejects(
      uploadReviewedHeroProp(
        "train-car",
        "abc123",
        directory,
        credentials,
        { fetchFn },
        assetsFile,
      ),
      /no passed review/,
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(await readHeroAssets(assetsFile), {});
  }
});

await test("uploadReviewedHeroProp records nothing when the upload fails", async () => {
  const { directory, assetsFile } = await generatedFolder({ hash: "abc123", passed: true });
  const { fetchFn } = fakeFetch([json({}, 500)]);
  await assert.rejects(
    uploadReviewedHeroProp("train-car", "abc123", directory, credentials, { fetchFn }, assetsFile),
    /500/,
  );
  assert.deepEqual(await readHeroAssets(assetsFile), {});
});
