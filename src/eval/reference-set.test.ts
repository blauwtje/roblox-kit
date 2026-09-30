import assert from "node:assert/strict";
import { test } from "node:test";
import { readReferenceSet, referenceImagePath } from "./reference-set.ts";

await test("every reference in the set names a preset and resolves to its game's folder", async () => {
  const references = await readReferenceSet();
  assert.ok(references.length > 0);
  for (const reference of references) {
    assert.ok(reference.preset.length > 0);
  }
  const animalHospital = references.find((reference) => reference.game === "Animal Hospital");
  assert.ok(animalHospital !== undefined);
  assert.match(
    referenceImagePath(animalHospital),
    new RegExp(`/eval/references/animal-hospital/${String(animalHospital.targetId)}\\.png$`),
  );
});
