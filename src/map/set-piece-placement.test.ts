import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { config } from "../config.ts";
import { layoutMap } from "./map-layout.ts";
import { mapSpecSchema, relationMapSpecSchema } from "./map-spec.ts";
import type { MapSpec } from "./map-spec.ts";
import { resolveRelations } from "./relation-solver.ts";
import { detailDimensions } from "./room-details.ts";
import { propDimensions } from "./prop-placement.ts";
import { placeSetPieces } from "./set-piece-placement.ts";
import { doorwayClearanceBoxes } from "./size-rules.ts";
import type { Preset } from "../style/preset-schema.ts";
import type { SetPieceRecord } from "./set-piece-placement.ts";
import { loadPresets } from "../style/load-preset.ts";
import { resolveStyle } from "../style/resolve-style.ts";

const accent = "#f5cd30";
const roomTypes = {
  platform: { setPieces: ["track-bed", "platform-edge"], signLabel: "Platform 1" },
  "ticket-hall": { setPieces: ["counter"], signLabel: "Tickets" },
  concourse: { setPieces: ["departure-board", "clock", "departure-board"], signLabel: "Concourse" },
};

const stationRules: Preset["propRules"] = {
  "track-bed": { freeRotation: false, placement: "track" },
  "platform-edge": { freeRotation: false, placement: "track" },
  "departure-board": { freeRotation: false, placement: "beside-door" },
  clock: { freeRotation: false, placement: "standing" },
  counter: { freeRotation: false, placement: "facing-entry" },
};

const northYaw = 0;
const southYaw = 180;

/** A 60x40 platform with a door in its south wall, and a 30x30 hall whose entry door is in its north wall. */
const stationSpec = mapSpecSchema.parse({
  mapId: "station",
  doorWidth: 6,
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
  return placeSetPieces(spec, roomTypes, accent, 1, [], stationRules).pieces;
}

function warningsOf(spec: MapSpec): string[] {
  return placeSetPieces(spec, roomTypes, accent, 1, [], stationRules).warnings;
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
  assert.ok(platformSign.pivot.z < 20 && platformSign.pivot.z > 15, "inside the south wall");
  assert.equal(platformSign.yaw, northYaw);
});

await test("a sign at a north or south door with no wall space beside it hangs in the doorway", () => {
  const spec = mapSpecSchema.parse({
    mapId: "narrow",
    rooms: [
      {
        name: "hall",
        roomType: "ticket-hall",
        x: 0,
        z: 0,
        width: 12,
        depth: 30,
        doors: [{ side: "south", offset: 0 }],
      },
    ],
  });
  const [sign] = piecesOf("sign", place(spec));
  assert.ok(sign);
  assert.equal(sign.pivot.x, 0);
  assert.equal(sign.yaw, northYaw);
  assert.equal(sign.pivot.z + propDimensions.sign.z / 2, 15 - 1);
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

await test("a departure board stands against the south wall west of a south door, facing north, off the wall by the larger depth", async () => {
  const spec = mapSpecSchema.parse({
    mapId: "concourse",
    doorWidth: 6,
    rooms: [
      {
        name: "concourse",
        roomType: "concourse",
        x: 0,
        z: 400,
        width: 60,
        depth: 40,
        doors: [
          { side: "north", offset: 0 },
          { side: "south", offset: 10 },
        ],
      },
    ],
  });
  const length = propDimensions["departure-board"].x;
  const archReach = 3 + detailDimensions.archJambWidthStuds - detailDimensions.archLipStuds;
  const eastEdge = 10 - archReach - propDimensions.clearanceStuds;
  const southInnerFace = 400 + 20 - 1;
  const ownDepth = propDimensions["departure-board"].z;
  const own = placeSetPieces(spec, roomTypes, accent, 1, [], stationRules).pieces;
  const [board] = piecesOf("departure-board", own);
  assert.ok(board);
  assert.equal(board.pivot.x, eastEdge - length / 2);
  assert.ok(Math.abs(board.pivot.z - (southInnerFace - ownDepth / 2)) < 1e-5);
  assert.equal(board.yaw, northYaw);
  assert.equal(board.pivot.y, propDimensions["departure-board"].y / 2);
  const station = (await loadPresets()).get("train-station");
  const recipe = station?.heroProps?.["departure-board"];
  assert.ok(recipe !== undefined);
  const deeperRecipe = { ...recipe, size: { ...recipe.size, depth: 3 } };
  const deeper = placeSetPieces(spec, roomTypes, accent, 1, [], stationRules, {
    board: deeperRecipe,
  });
  const [wider] = piecesOf("departure-board", deeper.pieces);
  assert.ok(wider);
  assert.ok(Math.abs(wider.pivot.z - (southInnerFace - 1.5)) < 1e-5);
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
  assert.throws(
    () => placeSetPieces(spec, odd, accent, 1, [], stationRules),
    /"throne", which has no generator/,
  );
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
  const unclamped = placeSetPieces(spec, roomTypes, accent, 1, [], stationRules).pieces;
  const [unclampedBed] = piecesOf("track-bed", unclamped);
  assert.ok(unclampedBed !== undefined);

  const { pieces, warnings } = placeSetPieces(spec, roomTypes, accent, 1, clearances, stationRules);

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

await test("every sign of the resolved train-station benchmark touches a wall part", async () => {
  const benchmark = new URL("../../eval/benchmarks/train-station.json", import.meta.url);
  const spec = resolveRelations(
    relationMapSpecSchema.parse(JSON.parse(await readFile(benchmark, "utf8"))),
  );
  assert.ok(spec.style !== undefined);
  const style = resolveStyle(await loadPresets(), spec.style);
  const walls = layoutMap(spec, style.surfaces, { ceilings: true }).parts.filter((part) =>
    part.name.includes(config.wallNameInfix),
  );
  const { pieces } = placeSetPieces(spec, style.roomTypes, style.palette.accent, spec.seed ?? 1);
  const signs = piecesOf("sign", pieces);
  assert.equal(signs.length, 4);
  const floating = signs.flatMap((sign, index) => {
    // A sign turned a quarter turn has its length along Z.
    const turned = sign.yaw === 90 || sign.yaw === 270;
    const half = {
      x: (turned ? sign.size.z : sign.size.x) / 2,
      y: sign.size.y / 2,
      z: (turned ? sign.size.x : sign.size.z) / 2,
    };
    const touching = walls.filter(
      (wall) =>
        Math.abs(sign.pivot.x - wall.position.x) <= half.x + wall.size.x / 2 &&
        Math.abs(sign.pivot.y - wall.position.y) <= half.y + wall.size.y / 2 &&
        Math.abs(sign.pivot.z - wall.position.z) <= half.z + wall.size.z / 2,
    );
    return touching.length === 0 ? [`sign-${String(index + 1)}`] : [];
  });
  assert.deepEqual(floating, [], "signs that touch no wall part");
});

await test("two rooms of one type get set pieces with different seeds", () => {
  const twin = (name: string, x: number) => ({
    name,
    roomType: "ticket-hall",
    x,
    z: 0,
    width: 30,
    depth: 30,
    doors: [{ side: "north", offset: -4 }],
  });
  const spec = mapSpecSchema.parse({
    mapId: "twins",
    doorWidth: 6,
    rooms: [twin("a", 0), twin("b", 100)],
  });
  const { pieces } = placeSetPieces(spec, roomTypes, accent, 1, [], stationRules);
  const counters = piecesOf("counter", pieces);
  assert.equal(counters.length, 2);
  assert.notEqual(counters[0]?.seed, counters[1]?.seed);
  const again = placeSetPieces(spec, roomTypes, accent, 1, [], stationRules).pieces;
  assert.deepEqual(again, pieces);
});

await test("a set piece with no placement stands free", () => {
  const spec = mapSpecSchema.parse({
    mapId: "hall",
    rooms: [
      {
        name: "hall",
        roomType: "ticket-hall",
        x: 0,
        z: 0,
        width: 60,
        depth: 40,
        doors: [{ side: "west", offset: 0 }],
      },
    ],
  });
  const [counter] = piecesOf("counter", placeSetPieces(spec, roomTypes, accent, 1).pieces);
  assert.ok(counter);
  assert.deepEqual([counter.pivot.x, counter.pivot.z, counter.yaw], [-14.5, 0, northYaw]);
});
