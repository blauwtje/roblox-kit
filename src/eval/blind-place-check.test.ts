import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { placeCheckBrief, placeMatches, type PlaceAnswer } from "./blind-place-check.ts";

const promptUrl = new URL("../../skills/visual-judge/place-check-prompt.md", import.meta.url);

await test("the blind brief names only the images, never the map", async () => {
  const brief = placeCheckBrief(await readFile(promptUrl, "utf8"), ["image-1.jpg", "image-2.jpg"]);
  assert.match(brief, /`image-1\.jpg` and `image-2\.jpg`/);
  assert.doesNotMatch(brief, /<source>|<paths>|capture_zones|eval:studio|neutral names/);
});

const right: PlaceAnswer = {
  clues: "",
  furnished: "furnished",
  genre: "train-station",
  room: "ticket hall",
};

const rows: {
  name: string;
  answer: Partial<PlaceAnswer>;
  roomType?: string;
  accepted?: string[];
  passes: boolean;
}[] = [
  { name: "exact room", answer: {}, passes: true },
  { name: "case, spaces and hyphens ignored", answer: { room: "Ticket-HALL" }, passes: true },
  {
    name: "accepted name",
    answer: { room: "Main Concourse" },
    accepted: ["main-concourse"],
    passes: true,
  },
  { name: "room type inside a longer name", answer: { room: "Grand Ticket Hall" }, passes: true },
  {
    name: "accepted name inside a longer name",
    answer: { room: "the main-concourse hall" },
    accepted: ["main concourse"],
    passes: true,
  },
  { name: "wrong room", answer: { room: "platform" }, passes: false },
  {
    name: "unlisted accepted name",
    answer: { room: "Main Concourse" },
    accepted: ["waiting room"],
    passes: false,
  },
  { name: "wrong genre", answer: { genre: "airport" }, passes: false },
  { name: "unknown genre", answer: { genre: "unknown" }, passes: false },
  { name: "empty room", answer: { furnished: "empty" }, passes: false },
  { name: "words held apart", answer: { room: "Ticket Waiting Hall" }, passes: false },
  { name: "partial name", answer: { room: "Ticket" }, passes: false },
  {
    name: "inside a longer word",
    answer: { room: "Platforms" },
    roomType: "platform",
    passes: false,
  },
  {
    name: "blank accepted name",
    answer: { room: "Hall" },
    roomType: "platform",
    accepted: [""],
    passes: false,
  },
];

await test("the blind check passes right answers and fails wrong and empty ones", () => {
  for (const row of rows) {
    const got = placeMatches(
      { ...right, ...row.answer },
      "train-station",
      row.roomType ?? "ticket-hall",
      row.accepted ?? [],
    );
    assert.equal(got, row.passes, row.name);
  }
});
