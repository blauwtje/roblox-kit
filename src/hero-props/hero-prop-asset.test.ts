import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { loadPresets } from "../style/load-preset.ts";
import { scriptedMeshHash } from "./generate-scripted-mesh.ts";
import { readHeroAssets } from "./hero-asset-store.ts";
import { heroPropAsset, heroRecipeHash, type HeroPropUploadSources } from "./hero-prop-asset.ts";

const presets = await loadPresets();
const preset = presets.get("train-station");
assert.ok(preset !== undefined);
const hash = await heroRecipeHash(preset, "train-car");
const apiKey = "test-key";

/** Open Cloud answers for a fake fetch: each call gets the next one, and every call is counted; no network. */
function fakeFetch(responses: Response[]): { fetchFn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchFn: typeof fetch = (input) => {
    calls.push(new Request(input).url);
    const next = responses.shift();
    return next === undefined
      ? Promise.reject(new Error("unexpected fetch"))
      : Promise.resolve(next);
  };
  return { fetchFn, calls };
}

/** A temporary hero-assets.json and a generated train car with a passed review, test credentials and `fetchFn`. */
async function reviewedTrainCar(fetchFn: typeof fetch): Promise<Required<HeroPropUploadSources>> {
  const directory = await mkdtemp(join(tmpdir(), "hero-prop-asset-"));
  const assetsFile = pathToFileURL(join(directory, "hero-assets.json"));
  await writeFile(assetsFile, JSON.stringify({}));
  const folder = join(directory, "hero-props", `train-station-train-car-${hash}`);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "review.json"), JSON.stringify({ hash, passed: true }));
  await writeFile(join(folder, "model.glb"), new Uint8Array([0x67, 0x6c, 0x54, 0x46]));
  return {
    assetsFile,
    heroPropsDirectory: pathToFileURL(join(directory, "hero-props/")),
    credentials: () =>
      Promise.resolve({ credentials: { apiKey, creator: { groupId: "718128661" } } }),
    transport: { fetchFn, pollIntervalMs: 0 },
  };
}

await test("a passed review with credentials uploads the GLB once, records it and reuses the id afterwards", async () => {
  const finished = {
    path: "operations/op1",
    operationId: "op1",
    done: true,
    response: { assetId: "9001" },
  };
  const { fetchFn, calls } = fakeFetch([Response.json(finished)]);
  const sources = await reviewedTrainCar(fetchFn);
  const first = await heroPropAsset("train-station", preset, "train-car", sources);
  assert.deepEqual(first, { hash, status: "uploaded", assetId: "9001" });
  assert.deepEqual(await readHeroAssets(sources.assetsFile), {
    [hash]: { kind: "train-car", assetId: "9001" },
  });
  const second = await heroPropAsset("train-station", preset, "train-car", sources);
  assert.deepEqual(second, { hash, status: "recorded", assetId: "9001" });
  assert.equal(calls.length, 1, "the recorded id is reused without a second upload");
});

await test("a failed upload records nothing and its error names the status but never the API key", async () => {
  const { fetchFn } = fakeFetch([Response.json({ message: "forbidden" }, { status: 403 })]);
  const sources = await reviewedTrainCar(fetchFn);
  const result = await heroPropAsset("train-station", preset, "train-car", sources);
  assert.equal(result.status, "upload-failed");
  assert.match(result.error, /403/);
  assert.ok(!result.error.includes(apiKey), "the API key never appears in the error text");
  assert.deepEqual(await readHeroAssets(sources.assetsFile), {});
});

await test("a declared mesh's recipe hash is its script hash, not a recipe's", async () => {
  const declaration = {
    script: "src/hero-props/meshes/train-station/pillar.py",
    targets: [{ replaces: "prop:pillar" }],
  };
  const declared = { ...preset, meshes: { "train-car": declaration } };
  assert.equal(
    await heroRecipeHash(declared, "train-car"),
    await scriptedMeshHash("train-car", declaration),
  );
  assert.notEqual(
    await heroRecipeHash(declared, "train-car"),
    await heroRecipeHash(preset, "train-car"),
  );
});
