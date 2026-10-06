import assert from "node:assert/strict";
import { test } from "node:test";
import { propDimensions, propKinds } from "../map/prop-placement.ts";
import { loadPresets } from "../style/load-preset.ts";
import { heroParts, presetSchema } from "../style/preset-schema.ts";
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

await test("each recipe is as wide and deep as its prop's placement box", () => {
  for (const kind of propKinds) {
    const recipe = propRecipes[propRecipeKind(kind)];
    assert.ok(recipe !== undefined);
    assert.equal(recipe.size.width, propDimensions[kind].x, kind);
    assert.equal(recipe.size.depth, propDimensions[kind].z, kind);
    assert.ok(heroParts(recipe.operations).length > 0, kind);
  }
});

await test("every shape of every prop recipe has a bevel", () => {
  for (const [name, recipe] of Object.entries(propRecipes)) {
    for (const part of heroParts(recipe.operations)) {
      const bevel = part.shape.bevel;
      assert.ok(bevel !== undefined && bevel > 0, `${name} ${part.shape.op} ${part.shape.role}`);
    }
  }
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
