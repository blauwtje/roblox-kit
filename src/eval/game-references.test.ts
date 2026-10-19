import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completedImageUrls,
  gameReferenceImagePaths,
  parseGameReferences,
  pickReferenceImages,
  readGameReferences,
} from "./game-references.ts";

await test("the shipped game references parse, with unique universes per game", async () => {
  const games = await readGameReferences();
  assert.deepEqual(games.map((entry) => entry.game).sort(), ["plus-one-escape", "steal-egg"]);
  for (const entry of games) {
    assert.ok(entry.references.length >= 3);
    const ids = entry.references.map((reference) => reference.universeId);
    assert.equal(new Set(ids).size, ids.length);
  }
});

await test("a duplicate game or a bad game name is rejected", () => {
  const reference = { name: "A", universeId: 1, placeId: 2, images: 1 };
  const entry = { game: "a-b", formula: "f", references: [reference] };
  assert.throws(() => parseGameReferences(JSON.stringify([entry, entry])), /twice/);
  assert.throws(() => parseGameReferences(JSON.stringify([{ ...entry, game: "A B" }])));
  assert.throws(() => parseGameReferences(JSON.stringify([{ ...entry, references: [] }])));
});

await test("image paths follow universe id and 1-based index", () => {
  const [entry] = parseGameReferences(
    JSON.stringify([
      {
        game: "g",
        formula: "f",
        references: [{ name: "A", universeId: 7, placeId: 8, images: 2 }],
      },
    ]),
  );
  assert.ok(entry);
  const paths = gameReferenceImagePaths(entry);
  assert.equal(paths.length, 2);
  assert.match(paths[0] ?? "", /references\/games\/g\/7-1\.png$/);
  assert.match(paths[1] ?? "", /7-2\.png$/);
});

await test("completedImageUrls skips pending thumbnails and stops at the count", () => {
  const urls = completedImageUrls(
    [
      { state: "Pending", imageUrl: null },
      { state: "Completed", imageUrl: "a" },
      { state: "Completed", imageUrl: null },
      { state: "Completed", imageUrl: "b" },
      { state: "Completed", imageUrl: "c" },
    ],
    2,
  );
  assert.deepEqual(urls, ["a", "b"]);
});

await test("pickReferenceImages alternates between games and respects the limit", () => {
  const picked = pickReferenceImages([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]], 5);
  assert.deepEqual(picked, ["a1", "b1", "c1", "a2", "c2"]);
  assert.deepEqual(pickReferenceImages([], 3), []);
});
