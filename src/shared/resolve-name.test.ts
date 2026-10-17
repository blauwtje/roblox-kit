import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveName } from "./resolve-name.ts";

const known = ["train-station", "Cozy Town", "lobby"];

await test("an exact key wins", () => {
  assert.equal(resolveName("lobby", known, "room type"), "lobby");
});

await test("case, spaces and hyphens are ignored", () => {
  assert.equal(resolveName("  Train  Station ", known, "preset"), "train-station");
  assert.equal(resolveName("cozy-town", known, "preset"), "Cozy Town");
});

await test("an exact key beats a normalized twin", () => {
  assert.equal(resolveName("a b", ["a b", "a-b"], "x"), "a b");
});

await test("no match throws listing every name", () => {
  assert.throws(
    () => resolveName("trainstation", known, "preset"),
    /Unknown preset "trainstation".*train-station, Cozy Town, lobby/,
  );
});

await test("two matches throw", () => {
  assert.throws(() => resolveName("A B", ["a b", "a-b"], "x"), /Unknown x "A B"/);
});
