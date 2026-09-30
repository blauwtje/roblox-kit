import assert from "node:assert/strict";
import { test } from "node:test";
import { placeArrangements } from "./arrangement-placement.ts";
import { mapSpecSchema } from "./map-spec.ts";
import type { MapSpec } from "./map-spec.ts";
import { placeSetPieces } from "./set-piece-placement.ts";
import type { SetPieceRecord } from "./set-piece-placement.ts";

const accent = "#f5cd30";
const seed = 1;
const roomTypes = {
  hall: {
    setPieces: ["departure-board"],
    signLabel: "Hall",
    arrangements: [
      { shape: "grid" as const, piece: "pillar", spacing: 20 },
      { shape: "rows" as const, piece: "bench", spacing: 10, perRow: 2 },
      {
        shape: "along-walls" as const,
        piece: "ticket-machine",
        spacing: 6,
        walls: "doorless" as const,
        inset: 0,
      },
    ],
  },
  platform: {
    setPieces: ["track-bed", "platform-edge"],
    signLabel: "Platform 1",
    arrangements: [
      { shape: "along-length" as const, piece: "lamp", spacing: 12, inset: 2 },
      { shape: "along-length" as const, piece: "pillar", spacing: 15 },
    ],
  },
  capped: {
    setPieces: [],
    signLabel: "Capped",
    arrangements: [
      {
        shape: "along-walls" as const,
        piece: "bench",
        spacing: 8,
        walls: "all" as const,
        inset: 1,
        max: 3,
      },
    ],
  },
  cramped: {
    setPieces: [],
    signLabel: "Cramped",
    arrangements: [{ shape: "grid" as const, piece: "pillar", spacing: 400 }],
  },
  bare: { setPieces: [], signLabel: "Bare" },
};

function room(
  name: string,
  roomType: string | undefined,
  width: number,
  depth: number,
  extra = {},
): unknown {
  return {
    name,
    roomType,
    x: 0,
    z: 0,
    width,
    depth,
    doors: [{ side: "south", offset: 0 }],
    ...extra,
  };
}

function specOf(...rooms: unknown[]): MapSpec {
  return mapSpecSchema.parse({ mapId: "station", rooms });
}

function arrange(spec: MapSpec): { pieces: SetPieceRecord[]; warnings: string[] } {
  const setPieces = placeSetPieces(spec, roomTypes, accent, seed).pieces;
  return placeArrangements(spec, roomTypes, setPieces, seed);
}

function countOf(kind: string, pieces: SetPieceRecord[]): number {
  return pieces.filter((piece) => piece.kind === kind).length;
}

function footprint(piece: SetPieceRecord): [number, number, number, number] {
  const turned = piece.yaw === 90 || piece.yaw === 270;
  const halfX = (turned ? piece.size.z : piece.size.x) / 2;
  const halfZ = (turned ? piece.size.x : piece.size.z) / 2;
  return [
    piece.pivot.x - halfX,
    piece.pivot.x + halfX,
    piece.pivot.z - halfZ,
    piece.pivot.z + halfZ,
  ];
}

function overlap(first: SetPieceRecord, second: SetPieceRecord): boolean {
  const [firstMinX, firstMaxX, firstMinZ, firstMaxZ] = footprint(first);
  const [secondMinX, secondMaxX, secondMinZ, secondMaxZ] = footprint(second);
  return (
    firstMinX < secondMaxX &&
    firstMaxX > secondMinX &&
    firstMinZ < secondMaxZ &&
    firstMaxZ > secondMinZ
  );
}

await test("a room of twice the floor area gets more pieces of each arrangement", () => {
  const small = arrange(specOf(room("hall", "hall", 60, 40))).pieces;
  const large = arrange(specOf(room("hall", "hall", 120, 40))).pieces;
  for (const kind of ["pillar", "bench", "ticket-machine"]) {
    assert.ok(countOf(kind, small) > 0, `${kind} is placed in the small room`);
    assert.ok(countOf(kind, large) > countOf(kind, small), `${kind} grows with the room`);
  }
  const smallPlatform = arrange(specOf(room("platform", "platform", 60, 40))).pieces;
  const largePlatform = arrange(specOf(room("platform", "platform", 120, 40))).pieces;
  for (const kind of ["lamp", "pillar"]) {
    assert.ok(
      countOf(kind, largePlatform) > countOf(kind, smallPlatform),
      `${kind} grows along the platform`,
    );
  }
});

await test("no piece overlaps a doorway lane, a spawn pad, a set piece or another piece", () => {
  const spec = specOf(room("hall", "hall", 80, 50, { spawn: true }));
  const setPieces = placeSetPieces(spec, roomTypes, accent, seed).pieces;
  const { pieces } = placeArrangements(spec, roomTypes, setPieces, seed);
  assert.ok(pieces.length > 10);
  pieces.forEach((piece, index) => {
    for (const other of [...setPieces, ...pieces.slice(index + 1)]) {
      assert.equal(
        overlap(piece, other),
        false,
        `${piece.kind} at ${JSON.stringify(piece.pivot)} overlaps ${other.kind}`,
      );
    }
    const [minX, maxX, minZ, maxZ] = footprint(piece);
    const doorWidth = 6;
    assert.equal(
      minX < doorWidth / 2 && maxX > -doorWidth / 2 && maxZ > 0,
      false,
      "clear of the south door lane and the spawn pad row",
    );
    assert.ok(minX >= -39 && maxX <= 39 && minZ >= -24 && maxZ <= 24, "inside the room");
  });
});

await test("the platform's lamps stand on the long wall the track bed is not on", () => {
  const spec = specOf(room("platform", "platform", 100, 40));
  const setPieces = placeSetPieces(spec, roomTypes, accent, seed).pieces;
  const trackBed = setPieces.find((piece) => piece.kind === "track-bed");
  assert.ok(trackBed && trackBed.pivot.z < 0, "the track bed hugs the north wall");
  const lamps = arrange(spec).pieces.filter((piece) => piece.kind === "lamp");
  assert.ok(lamps.length > 0 && lamps.every((lamp) => lamp.pivot.z > 0));
});

await test("rows face along the long axis toward the first door", () => {
  const spec = specOf(room("hall", "hall", 100, 40, { doors: [{ side: "east", offset: 0 }] }));
  const benches = arrange(spec).pieces.filter((piece) => piece.kind === "bench");
  assert.ok(benches.length > 0 && benches.every((bench) => bench.yaw === 270));
});

await test("max caps an arrangement's pieces", () => {
  const spec = specOf(room("capped", "capped", 120, 80));
  assert.equal(countOf("bench", arrange(spec).pieces), 3);
});

await test("an arrangement that places nothing adds one warning, and a room without arrangements adds none", () => {
  const cramped = specOf(room("cramped", "cramped", 20, 20));
  assert.equal(arrange(cramped).pieces.length, 0);
  assert.equal(arrange(cramped).warnings.length, 1);
  assert.match(arrange(cramped).warnings[0] ?? "", /"cramped".*grid of pillar/);
  const others = specOf(room("bare", "bare", 60, 40), room("yard", undefined, 60, 40));
  assert.deepEqual(arrange(others), { pieces: [], warnings: [] });
  assert.deepEqual(placeArrangements(others, undefined, [], seed), { pieces: [], warnings: [] });
});

await test("the same spec builds the same layout, each piece with its own seed", () => {
  const spec = specOf(room("hall", "hall", 80, 50));
  const { pieces } = arrange(spec);
  assert.deepEqual(arrange(spec), arrange(spec));
  assert.ok(pieces.length > 1);
  assert.equal(new Set(pieces.map((piece) => piece.seed)).size, pieces.length);
});

await test("an arranged piece with no generator throws", () => {
  const spec = specOf(room("hall", "hall", 60, 40));
  const broken = {
    hall: {
      setPieces: [],
      signLabel: "Hall",
      arrangements: [{ shape: "grid" as const, piece: "throne", spacing: 10 }],
    },
  };
  assert.throws(() => placeArrangements(spec, broken, [], seed), /"throne".*no generator/);
});
