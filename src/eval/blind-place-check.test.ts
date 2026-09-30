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
  const answer = {
    clues: "",
    furnished: "furnished" as const,
    genre: "train-station",
    room: "Ticket Hall",
  };
  assert.equal(placeMatches(answer, "train-station", "ticket-hall", []), true);
  assert.equal(placeMatches(answer, "train-station", "platform", []), false);
  assert.equal(
    placeMatches({ ...answer, genre: "unknown" }, "train-station", "ticket-hall", []),
    false,
  );
});

await test("a name the room type lists matches, ignoring case, spaces and hyphens; an unlisted one does not", () => {
  const answer = {
    clues: "",
    furnished: "furnished" as const,
    genre: "train-station",
    room: "Main Concourse",
  };
  assert.equal(placeMatches(answer, "train-station", "ticket-hall", ["main-concourse"]), true);
  assert.equal(placeMatches(answer, "train-station", "ticket-hall", ["waiting room"]), false);
  assert.equal(
    placeMatches({ ...answer, genre: "airport" }, "train-station", "ticket-hall", [
      "main-concourse",
    ]),
    false,
  );
});

await test("a name that contains the room type or a listed name as a run of whole words matches", () => {
  const answer = {
    clues: "",
    furnished: "furnished" as const,
    genre: "train-station",
    room: "Train Station Platform",
  };
  assert.equal(placeMatches(answer, "train-station", "platform", []), true);
  assert.equal(
    placeMatches({ ...answer, room: "Platform 4 Waiting Area" }, "train-station", "platform", []),
    true,
  );
  assert.equal(
    placeMatches({ ...answer, room: "the main-concourse hall" }, "train-station", "concourse", []),
    true,
  );
  assert.equal(
    placeMatches({ ...answer, room: "Grand Ticket Hall" }, "train-station", "ticket-hall", []),
    true,
  );
  assert.equal(
    placeMatches({ ...answer, room: "Main Hall" }, "train-station", "concourse", ["main hall"]),
    true,
  );
});

await test("a name that holds the words apart, partly or inside a longer word does not match", () => {
  const answer = {
    clues: "",
    furnished: "furnished" as const,
    genre: "train-station",
    room: "Ticket Waiting Hall",
  };
  assert.equal(placeMatches(answer, "train-station", "ticket-hall", []), false);
  assert.equal(
    placeMatches({ ...answer, room: "Ticket" }, "train-station", "ticket-hall", []),
    false,
  );
  assert.equal(
    placeMatches({ ...answer, room: "Platforms" }, "train-station", "platform", []),
    false,
  );
  assert.equal(placeMatches({ ...answer, room: "Hall" }, "train-station", "platform", [""]), false);
});

await test("an empty answer fails even when the genre and room are right", () => {
  const answer = {
    clues: "",
    genre: "train-station",
    room: "ticket hall",
    furnished: "empty" as const,
  };
  assert.equal(placeMatches(answer, "train-station", "ticket-hall", []), false);
  assert.equal(
    placeMatches({ ...answer, furnished: "furnished" }, "train-station", "ticket-hall", []),
    true,
  );
});
