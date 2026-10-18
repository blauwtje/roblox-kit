import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSpecSchema } from "./map-spec.ts";
import {
  departureHeaderImage,
  departureRows,
  signageAttributes,
  signageImageHash,
  ticketScreenImage,
} from "./signage-text.ts";
import type { Preset } from "../style/preset-schema.ts";

const roomTypes = {
  platform: { setPieces: ["track-bed", "platform-edge"], signLabel: "Platform 3" },
  concourse: { setPieces: ["departure-board"], signLabel: "Concourse" },
} as unknown as Preset["roomTypes"];

const room = { x: 0, z: 0, width: 30, depth: 30, doors: [{ side: "south", offset: 0 }] };
const withPlatform = mapSpecSchema.parse({
  mapId: "m",
  rooms: [
    { name: "a", roomType: "platform", ...room },
    { name: "b", roomType: "concourse", ...room, x: 100 },
  ],
});
const withoutPlatform = mapSpecSchema.parse({
  mapId: "m",
  rooms: [{ name: "b", roomType: "concourse", ...room }],
});
const destinations = ["CENTRAL", "HARBOUR", "NORTH PARK", "AIRPORT"];
const input = (spec: typeof withPlatform, records = {}) => ({
  spec,
  roomTypes,
  destinations,
  records,
});
const record = (image: typeof departureHeaderImage) => ({
  [signageImageHash(image)]: { name: image.name, kind: "signage", assetId: "42" },
});

await test("departure rows name only platforms that exist and repeat per seed", () => {
  const rows = departureRows(7, destinations, [3]);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.endsWith(" 3")));
  assert.deepEqual(rows, departureRows(7, destinations, [3]));
});

await test("a cached header sets HeaderImage and no warning; a miss sets HeaderText and names the image", () => {
  const hit = signageAttributes(
    "departure-board",
    1,
    input(withPlatform, record(departureHeaderImage)),
  );
  assert.equal(hit.attributes.HeaderImage, "rbxassetid://42");
  assert.equal(hit.attributes.HeaderText, undefined);
  assert.deepEqual(hit.warnings, []);
  const miss = signageAttributes("departure-board", 1, input(withPlatform));
  assert.equal(miss.attributes.HeaderText, "DEPARTURES");
  assert.equal(miss.attributes.HeaderImage, undefined);
  assert.match(miss.warnings.join(), /departure-board-header/);
});

await test("Rows is newline-joined, and absent when the map has no platform", () => {
  const planned = signageAttributes("departure-board", 1, input(withPlatform));
  assert.equal(planned.attributes.Rows?.split("\n").length, 4);
  assert.equal(
    signageAttributes("departure-board", 1, input(withoutPlatform)).attributes.Rows,
    undefined,
  );
});

await test("the ticket machine screen is an image on a hit and text on a miss; other kinds get nothing", () => {
  const hit = signageAttributes(
    "ticket-machine",
    1,
    input(withPlatform, record(ticketScreenImage)),
  );
  assert.equal(hit.attributes.ScreenImage, "rbxassetid://42");
  const miss = signageAttributes("ticket-machine", 1, input(withPlatform));
  assert.equal(miss.attributes.ScreenText, "BUY TICKET");
  assert.match(miss.warnings.join(), /ticket-machine-screen/);
  assert.deepEqual(signageAttributes("clock", 1, input(withPlatform)), {
    attributes: {},
    warnings: [],
  });
});
