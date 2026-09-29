import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { placeCheckBrief, placeMatches } from "./blind-place-check.ts";

const promptUrl = new URL("../../skills/visual-judge/place-check-prompt.md", import.meta.url);

await test("the eval brief is the prompt's brief with the images as its source and nothing about the map", async () => {
  const brief = placeCheckBrief(await readFile(promptUrl, "utf8"), ["image-1.jpg", "image-2.jpg"]);
  assert.match(brief, /^You are a first-time visitor/);
  assert.match(
    brief,
    /Read the images `image-1\.jpg` and `image-2\.jpg`, which hold view a then view b/,
  );
  assert.doesNotMatch(brief, /<source>|<paths>|capture_zones|eval:studio|neutral names/);
});

await test("a prompt without the eval source line is rejected", () => {
  assert.throws(() => placeCheckBrief("# Prompt\n\n---\n\nBrief <source>", []), /no line starting/);
});

await test("the room matches ignoring case, spaces and hyphens; another genre or unknown does not", () => {
  const answer = { clues: "", genre: "train-station", room: "Ticket Hall" };
  assert.equal(placeMatches(answer, "train-station", "ticket-hall", []), true);
  assert.equal(placeMatches(answer, "train-station", "platform", []), false);
  assert.equal(
    placeMatches({ ...answer, genre: "unknown" }, "train-station", "ticket-hall", []),
    false,
  );
});

await test("a name the room type lists matches, ignoring case, spaces and hyphens; an unlisted one does not", () => {
  const answer = { clues: "", genre: "train-station", room: "Main Concourse" };
  assert.equal(placeMatches(answer, "train-station", "ticket-hall", ["main-concourse"]), true);
  assert.equal(placeMatches(answer, "train-station", "ticket-hall", ["waiting room"]), false);
  assert.equal(
    placeMatches({ ...answer, genre: "airport" }, "train-station", "ticket-hall", [
      "main-concourse",
    ]),
    false,
  );
});
