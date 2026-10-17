import assert from "node:assert/strict";
import { test } from "node:test";
import { propKinds } from "../map/prop-placement.ts";
import { loadPresets } from "../style/load-preset.ts";
import { presetSchema } from "../style/preset-schema.ts";
import { heroRecipeOf, propRecipeKind, propRecipeKindsOf, propRecipes } from "./prop-recipes.ts";

const presets = await loadPresets();
const base = presets.get("train-station");
assert.ok(base !== undefined);

await test("every prop kind has a recipe that replaces it and passes the preset schema", () => {
  assert.deepEqual(Object.keys(propRecipes).sort(), propKinds.map(propRecipeKind).sort());
  for (const kind of propKinds) assert.equal(propRecipes[propRecipeKind(kind)]?.replaces, kind);
  const parsed = presetSchema.safeParse({
    ...base,
    heroProps: { ...base.heroProps, ...propRecipes },
  });
  assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);
});

await test("a preset's own hero prop wins over a prop recipe, and its prop kit names its prop recipes", () => {
  assert.equal(heroRecipeOf(base, "departure-board"), base.heroProps?.["departure-board"]);
  assert.equal(heroRecipeOf(base, "prop-departure-board"), propRecipes["prop-departure-board"]);
  assert.equal(heroRecipeOf(base, "no-such-kind"), undefined);
  assert.deepEqual(
    propRecipeKindsOf(base),
    base.propKit.map((name) => `prop-${name}`),
  );
});

await test("the clutter kinds bin, luggage, potted plant, newspaper stack and poster have recipes", () => {
  for (const kind of ["bin", "luggage", "potted-plant", "newspaper-stack", "poster"]) {
    assert.ok(propKinds.includes(kind as (typeof propKinds)[number]), kind);
    assert.equal(propRecipes[propRecipeKind(kind as (typeof propKinds)[number])]?.replaces, kind);
  }
});
