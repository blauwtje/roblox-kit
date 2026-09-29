import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { loadPresets } from "../style/load-preset.ts";
import { applyLighting } from "./apply-lighting.ts";

const presets = await loadPresets();
const cozyTown = presets.get("cozy-town");
if (cozyTown === undefined) {
  throw new Error("The cozy-town preset is missing.");
}
const recipe = cozyTown.lighting;

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

await test("apply-lighting.luau is strict, restores a stored snapshot before writing and never touches Technology", async () => {
  const source = await readFile(new URL("../../luau/apply-lighting.luau", import.meta.url), "utf8");
  const restoreAt = source.indexOf("restore(HttpService:JSONDecode");
  const snapshotAt = source.indexOf("snapshotNow())");
  const writeAt = source.indexOf("writeLighting(recipe)");
  assert.ok(source.startsWith("--!strict"));
  assert.ok(source.includes("RobloxKitLightingSnapshot"));
  assert.ok(!source.includes("Lighting.Technology"));
  assert.ok(restoreAt > 0 && restoreAt < writeAt);
  assert.ok(snapshotAt > 0 && snapshotAt < writeAt);
});
