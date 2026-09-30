import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSpecSchema } from "./map-spec.ts";
import type { MapSpec } from "./map-spec.ts";
import { propDimensions, propKinds } from "./prop-placement.ts";
import { placeSetPieces } from "./set-piece-placement.ts";
import { doorwayClearanceBoxes } from "./size-rules.ts";
import type { SetPieceRecord } from "./set-piece-placement.ts";
import { loadPresets } from "../style/load-preset.ts";

const accent = "#f5cd30";
const roomTypes = {
  platform: { setPieces: ["track-bed", "platform-edge"], signLabel: "Platform 1" },
  "ticket-hall": { setPieces: ["counter"], signLabel: "Tickets" },
  concourse: { setPieces: ["departure-board", "clock", "departure-board"], signLabel: "Concourse" },
};

const northYaw = 0;
const southYaw = 180;

/** A 60x40 platform with a door in its south wall, and a 30x30 hall whose entry door is in its north wall. */
const stationSpec = mapSpecSchema.parse({
  mapId: "station",
  rooms: [
    {
      name: "platform",
      roomType: "platform",
      x: 0,
      z: 0,
      width: 60,
      depth: 40,
      doors: [{ side: "south", offset: 5 }],
    },
    {
      name: "hall",
      roomType: "ticket-hall",
      x: 100,
      z: 0,
      width: 30,
      depth: 30,
      doors: [
        { side: "north", offset: -4 },
        { side: "east", offset: 0 },
      ],
    },
    { name: "yard", x: 200, z: 0, width: 30, depth: 30, doors: [{ side: "north", offset: 0 }] },
  ],
});

function piecesOf(kind: string, pieces: SetPieceRecord[]): SetPieceRecord[] {
  return pieces.filter((piece) => piece.kind === kind);
}

function place(spec: MapSpec): SetPieceRecord[] {
  return placeSetPieces(spec, roomTypes, accent, 1).pieces;
}

function warningsOf(spec: MapSpec): string[] {
  return placeSetPieces(spec, roomTypes, accent, 1).warnings;
}

await test("a room without a type gets no set pieces, and neither does a style without room types", () => {
  const pieces = place(stationSpec);
  assert.ok(pieces.every((piece) => piece.pivot.x < 150));
  assert.deepEqual(placeSetPieces(stationSpec, undefined, accent, 1), { pieces: [], warnings: [] });
  assert.deepEqual(warningsOf(stationSpec), []);
});

await test("the track bed and platform edge run along the longest doorless wall", () => {
  const pieces = place(stationSpec);
  const [trackBed] = piecesOf("track-bed", pieces);
  const [platformEdge] = piecesOf("platform-edge", pieces);
  assert.ok(trackBed && platformEdge);
  // Doorless walls are north, east and west; the north wall is the longest (58 studs against 38).
  const northInnerFace = -20 + 1;
  assert.equal(trackBed.pivot.z, northInnerFace + propDimensions["track-bed"].z / 2);
  assert.equal(
    platformEdge.pivot.z,
    northInnerFace + propDimensions["track-bed"].z + propDimensions["platform-edge"].z / 2,
  );
  assert.equal(trackBed.pivot.x, 0);
  assert.equal(trackBed.size.x, platformEdge.size.x);
  assert.ok(trackBed.size.x > propDimensions["track-bed"].x - 1 && trackBed.size.x <= 58);
  // The platform edge looks at the track, the wall side.
  assert.equal(platformEdge.yaw, northYaw);
  assert.equal(trackBed.yaw, southYaw);
});

await test("the counter stands against the wall opposite the entry door and faces it", () => {
  const [counter] = piecesOf("counter", place(stationSpec));
  assert.ok(counter);
  const southInnerFace = 15 - 1;
  assert.ok(counter.pivot.z < southInnerFace && counter.pivot.z > southInnerFace - 4);
  assert.equal(counter.pivot.x, 100 - 4);
  assert.equal(counter.yaw, northYaw);
});

await test("every door of a typed room gets a sign with the room type's label and accent, inside and above it", () => {
  const signs = piecesOf("sign", place(stationSpec));
  assert.equal(signs.length, 3);
  for (const sign of signs) {
    assert.deepEqual(sign.attributes, {
      Label: sign.pivot.x < 50 ? "Platform 1" : "Tickets",
      AccentColor: accent,
    });
    assert.ok(sign.pivot.y > 6 && sign.pivot.y < 12, "hangs high, under the ceiling");
  }
  const [platformSign] = signs;
  assert.ok(platformSign);
  assert.equal(platformSign.pivot.x, 5);
  assert.ok(platformSign.pivot.z < 20 && platformSign.pivot.z > 15, "inside the south wall");
  assert.equal(platformSign.yaw, northYaw);
});

await test("a sign at an east or west door sticks out beside the doorway with its faces north and south", () => {
  const eastSign = piecesOf("sign", place(stationSpec)).at(-1);
  assert.ok(eastSign);
  const eastInnerFace = 100 + 15 - 1;
  assert.equal(eastSign.pivot.x, eastInnerFace - propDimensions.sign.x / 2);
  // Clear of the 6-stud doorway at offset 0: half the door, the clearance and half the sign's thickness.
  assert.equal(eastSign.pivot.z, -(3 + propDimensions.clearanceStuds + propDimensions.sign.z / 2));
  assert.equal(eastSign.yaw, northYaw);
});

await test("an east door with no wall space beside it gets its sign hung in the doorway", () => {
  const spec = mapSpecSchema.parse({
    mapId: "narrow",
    rooms: [
      {
        name: "hall",
        roomType: "ticket-hall",
        x: 0,
        z: 0,
        width: 30,
        depth: 10,
        doors: [{ side: "east", offset: 0 }],
      },
    ],
  });
  const [sign] = piecesOf("sign", place(spec));
  assert.ok(sign);
  assert.equal(sign.pivot.z, 0);
  assert.equal(sign.yaw, 90);
});

await test("a departure board and a clock stand free a quarter width from center, faces north and south", () => {
  const spec = mapSpecSchema.parse({
    mapId: "concourse",
    rooms: [
      {
        name: "concourse",
        roomType: "concourse",
        x: 0,
        z: 400,
        width: 60,
        depth: 40,
        doors: [{ side: "west", offset: 0 }],
      },
    ],
  });
  const pieces = place(spec);
  const [board] = piecesOf("departure-board", pieces);
  const [clock] = piecesOf("clock", pieces);
  assert.ok(board && clock);
  assert.deepEqual([board.pivot.x, board.pivot.z, board.yaw], [-14.5, 400, northYaw]);
  assert.deepEqual([clock.pivot.x, clock.pivot.z, clock.yaw], [14.5, 400, northYaw]);
  assert.equal(board.pivot.y, propDimensions["departure-board"].y / 2);
  assert.deepEqual(warningsOf(spec), [
    'Room "concourse" already holds 2 standing pieces, so departure-board has no spot left. The departure-board is skipped.',
  ]);
});

await test("a standing piece a narrow room cannot keep out of its doorway strips is skipped", () => {
  const spec = mapSpecSchema.parse({
    mapId: "kiosk",
    rooms: [{ name: "kiosk", roomType: "concourse", x: 0, z: 0, width: 30, depth: 30 }],
  });
  assert.deepEqual(piecesOf("departure-board", place(spec)), []);
  assert.match(warningsOf(spec)[0] ?? "", /"kiosk" is too small for its set piece departure-board/);
});

await test("the same spec gives the same set pieces", () => {
  assert.deepEqual(place(stationSpec), place(stationSpec));
});

await test("a room with a door in every wall skips its track pieces with a warning", () => {
  const spec = mapSpecSchema.parse({
    mapId: "closed",
    rooms: [
      {
        name: "platform",
        roomType: "platform",
        x: 0,
        z: 0,
        width: 60,
        depth: 40,
        doors: ["north", "south", "east", "west"].map((side) => ({ side, offset: 0 })),
      },
    ],
  });
  assert.deepEqual(
    place(spec).map((piece) => piece.kind),
    ["sign", "sign", "sign", "sign"],
  );
  const warnings = warningsOf(spec);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0] ?? "", /"platform" has a door in every wall.*track-bed is skipped/);
  assert.match(warnings[1] ?? "", /platform-edge is skipped/);
});

await test("a room too small for its set piece skips it with a warning naming the room", () => {
  const spec = mapSpecSchema.parse({
    mapId: "tiny",
    rooms: [{ name: "shed", roomType: "ticket-hall", x: 0, z: 0, width: 10, depth: 10 }],
  });
  assert.deepEqual(place(spec), []);
  assert.deepEqual(warningsOf(spec), [
    'Room "shed" is too small for its set piece counter; enlarge the room. The counter is skipped.',
  ]);
});

await test("a piece whose wall the doorways fill is skipped with a warning, and the room keeps its signs", () => {
  const spec = mapSpecSchema.parse({
    mapId: "vault",
    rooms: [
      {
        name: "vault",
        roomType: "ticket-hall",
        x: 0,
        z: 0,
        width: 20,
        depth: 20,
        doors: [
          { side: "west", offset: 0 },
          { side: "east", offset: 0 },
        ],
      },
    ],
  });
  assert.deepEqual(
    place(spec).map((piece) => piece.kind),
    ["sign", "sign"],
  );
  assert.deepEqual(warningsOf(spec), [
    'Room "vault" has no space on its east wall clear of the doorways. The counter is skipped.',
  ]);
});

await test("a set piece with no generator is rejected", () => {
  const spec = mapSpecSchema.parse({
    mapId: "unknown",
    rooms: [{ name: "hall", roomType: "odd", x: 0, z: 0, width: 40, depth: 40 }],
  });
  const odd = { odd: { setPieces: ["throne"], signLabel: "Odd" } };
  assert.throws(() => placeSetPieces(spec, odd, accent, 1), /"throne", which has no generator/);
});

await test("every set piece a bundled preset names has a generator", async () => {
  const presets = await loadPresets();
  const kinds: readonly string[] = propKinds;
  for (const [name, preset] of presets) {
    for (const [roomType, { setPieces }] of Object.entries(preset.roomTypes ?? {})) {
      for (const setPiece of setPieces) {
        assert.ok(kinds.includes(setPiece), `${name} ${roomType}: ${setPiece} has no generator`);
      }
    }
  }
});

await test("placeSetPieces keeps the track bed and platform edge out of every doorway clearance box", () => {
  // A west door whose clearance box reaches into the north wall's strip, where the track pieces run.
  const spec = mapSpecSchema.parse({
    ...stationSpec,
    rooms: stationSpec.rooms.map((room) =>
      room.name === "platform"
        ? { ...room, doors: [...room.doors, { side: "west", offset: -12 }] }
        : room,
    ),
  });
  const agent = { radius: 2, height: 5 };
  const clearances = doorwayClearanceBoxes(spec, agent);
  const unclamped = placeSetPieces(spec, roomTypes, accent, 1).pieces;
  const [unclampedBed] = piecesOf("track-bed", unclamped);
  assert.ok(unclampedBed !== undefined);

  const { pieces, warnings } = placeSetPieces(spec, roomTypes, accent, 1, clearances);

  assert.deepEqual(warnings, []);
  const tracks = [...piecesOf("track-bed", pieces), ...piecesOf("platform-edge", pieces)];
  assert.equal(tracks.length, 2);
  for (const track of tracks) {
    for (const clearance of clearances) {
      const overlapsX =
        track.pivot.x - track.size.x / 2 < clearance.max.x &&
        track.pivot.x + track.size.x / 2 > clearance.min.x;
      const overlapsZ =
        track.pivot.z - track.size.z / 2 < clearance.max.z &&
        track.pivot.z + track.size.z / 2 > clearance.min.z;
      assert.ok(
        !(overlapsX && overlapsZ),
        `${track.kind} stands in the ${clearance.side} doorway of ${clearance.room}`,
      );
    }
  }
  assert.ok(tracks.every((track) => track.size.x < unclampedBed.size.x));
  assert.equal(tracks[0]?.pivot.x, tracks[1]?.pivot.x);
  assert.equal(tracks[0]?.size.x, tracks[1]?.size.x);
});
