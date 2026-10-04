import assert from "node:assert/strict";
import { test } from "node:test";
import { recipeHash } from "./recipe-hash.ts";

const recipe = { size: { width: 4, height: 2 }, parts: [{ shape: "box", role: "wall" }] };

await test("recipeHash is stable and independent of key order", () => {
  const reordered = { parts: [{ role: "wall", shape: "box" }], size: { height: 2, width: 4 } };
  assert.equal(recipeHash(recipe, "source"), recipeHash(reordered, "source"));
  assert.match(recipeHash(recipe, "source"), /^[0-9a-f]{12}$/);
});

await test("recipeHash changes with the recipe", () => {
  const taller = { ...recipe, size: { width: 4, height: 3 } };
  assert.notEqual(recipeHash(recipe, "source"), recipeHash(taller, "source"));
});

await test("recipeHash changes with the generator source", () => {
  assert.notEqual(recipeHash(recipe, "source"), recipeHash(recipe, "source changed"));
});

await test("recipeHash keeps array order significant", () => {
  const parts = [{ role: "wall" }, { role: "floor" }];
  assert.notEqual(
    recipeHash({ parts }, "source"),
    recipeHash({ parts: [...parts].reverse() }, "source"),
  );
});
