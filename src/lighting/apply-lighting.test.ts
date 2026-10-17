import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { loadPresets } from "../style/load-preset.ts";
import { applyLighting, withoutZeroStrengthEffects } from "./apply-lighting.ts";

const presets = await loadPresets();
const cozyTown = presets.get("cozy-town");
if (cozyTown === undefined) {
  throw new Error("The cozy-town preset is missing.");
}
const recipe = cozyTown.lighting;

const trainStation = presets.get("train-station");
if (trainStation === undefined) {
  throw new Error("The train-station preset is missing.");
}

function studioReturning(text: string, isError = false) {
  return new FakeStudioConnection([{ id: "studio-a", name: "Place A" }], {
    execute_luau: () => ({ content: [{ type: "text", text }], isError }),
  });
}

function request(studio: FakeStudioConnection) {
  return {
    connection: studio,
    studioId: "studio-a",
    mapsFolderName: "Maps",
    mapId: "town",
    recipe,
  };
}

await test("sends the map handle and the whole recipe to Studio and returns whether a snapshot was taken", async () => {
  const studio = studioReturning('{"snapshotTaken":true}');
  const applied = await applyLighting(request(studio));

  assert.deepEqual(applied, { snapshotTaken: true });
  const [sent] = studio.requests;
  assert.equal(sent?.name, "execute_luau");
  assert.equal(sent.arguments["datamodel_type"], "Edit");
  const code = String(sent.arguments["code"]);
  assert.ok(code.includes('"mapId":"town"'));
  assert.ok(code.includes('"mapsFolderName":"Maps"'));
  assert.ok(code.includes('"LightingStyle":"Soft"'));
  assert.ok(code.includes('"Atmosphere":{'));
  assert.ok(code.includes('"Bloom":{'));
});

await test("without a recipe sends none, for a restore of the stored snapshot only", async () => {
  const studio = studioReturning('{"snapshotTaken":false}');
  const applied = await applyLighting({ ...request(studio), recipe: undefined });

  assert.deepEqual(applied, { snapshotTaken: false });
  const code = String(studio.requests[0]?.arguments["code"]);
  assert.ok(code.includes('"mapId":"town"'));
  assert.ok(!code.includes('"recipe"'));
});

await test("reports a rerun that found a stored snapshot", async () => {
  const applied = await applyLighting(request(studioReturning('{"snapshotTaken":false}')));
  assert.deepEqual(applied, { snapshotTaken: false });
});

await test("surfaces Studio's error when the map is missing", async () => {
  const studio = studioReturning('Map "town" is not under Workspace.Maps', true);
  await assert.rejects(applyLighting(request(studio)), /is not under Workspace/);
});

await test("rejects a result that is not the reported shape", async () => {
  await assert.rejects(applyLighting(request(studioReturning('{"snapshotTaken":"yes"}'))));
});

function removeRequest(studio: FakeStudioConnection) {
  return {
    connection: studio,
    studioId: "studio-a",
    mapsFolderName: "Maps",
    mapId: "town",
    removing: true as const,
  };
}

await test("removing sends the removing flag and no recipe", async () => {
  const studio = studioReturning('{"restored":"original","remainingStyledMaps":[]}');
  await applyLighting(removeRequest(studio));
  const code = String(studio.requests[0]?.arguments["code"]);
  assert.equal(studio.requests[0]?.arguments["datamodel_type"], "Edit");
  assert.ok(code.includes('"removing":true'));
  assert.ok(!code.includes('"recipe"'));
});

const removingCases = [
  {
    name: "the restored original",
    reply: '{"restored":"original","remainingStyledMaps":[]}',
    expected: { restored: "original", remainingStyledMaps: [] },
  },
  {
    name: "an absent restored key, which Luau drops for nil, as null with the remaining maps",
    reply: '{"remainingStyledMaps":["keep","other"]}',
    expected: { restored: null, remainingStyledMaps: ["keep", "other"] },
  },
  {
    name: "the map's own snapshot for an older place",
    reply: '{"restored":"map","remainingStyledMaps":[]}',
    expected: { restored: "map", remainingStyledMaps: [] },
  },
];
for (const { name, reply, expected } of removingCases) {
  await test(`removing reports ${name}`, async () => {
    assert.deepEqual(await applyLighting(removeRequest(studioReturning(reply))), expected);
  });
}

await test("removing rejects a restored value outside original and map", async () => {
  await assert.rejects(
    applyLighting(removeRequest(studioReturning('{"restored":"both","remainingStyledMaps":[]}'))),
  );
});

await test("sends the post-processing block of a preset that has one, and none for a preset without", async () => {
  const withBlock = studioReturning('{"snapshotTaken":true}');
  await applyLighting({ ...request(withBlock), recipe: trainStation.lighting });
  const code = String(withBlock.requests[0]?.arguments["code"]);
  for (const key of ["PostProcessing", "ColorCorrection", "SunRays", "DepthOfField", "Sky"]) {
    assert.ok(code.includes(`"${key}":{`), key);
  }
  const without = studioReturning('{"snapshotTaken":true}');
  await applyLighting({ ...request(without), recipe: { ...recipe, PostProcessing: undefined } });
  assert.ok(!String(without.requests[0]?.arguments["code"]).includes('"PostProcessing":{'));
});

await test("leaves out post effects with zero strength and keeps the others", async () => {
  const stationRecipe = trainStation.lighting;
  const postProcessing = stationRecipe.PostProcessing;
  assert.ok(postProcessing);
  const zeroed = {
    ...stationRecipe,
    PostProcessing: {
      ...postProcessing,
      ColorCorrection: { Brightness: 0, Contrast: 0, Saturation: 0, TintColor: "#FFFFFF" },
      SunRays: { ...postProcessing.SunRays, Intensity: 0 },
      DepthOfField: { ...postProcessing.DepthOfField, FarIntensity: 0, NearIntensity: 0 },
    },
  };
  const flat = withoutZeroStrengthEffects(zeroed);
  assert.deepEqual(Object.keys(flat.PostProcessing ?? {}), ["Sky"]);

  const live = withoutZeroStrengthEffects({
    ...stationRecipe,
    PostProcessing: {
      ...postProcessing,
      SunRays: { ...postProcessing.SunRays, Intensity: 0.2 },
      DepthOfField: { ...postProcessing.DepthOfField, FarIntensity: 0, NearIntensity: 0.1 },
    },
  });
  assert.ok("SunRays" in (live.PostProcessing ?? {}));
  assert.ok("DepthOfField" in (live.PostProcessing ?? {}));

  const studio = studioReturning('{"snapshotTaken":true}');
  await applyLighting({
    ...request(studio),
    recipe: zeroed,
  });
  assert.ok(!String(studio.requests[0]?.arguments["code"]).includes('"SunRays":{'));
});
