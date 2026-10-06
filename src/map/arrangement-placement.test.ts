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
  colonnaded: {
    setPieces: [],
    signLabel: "Colonnaded",
    arrangements: [{ shape: "colonnade" as const, piece: "pillar", spacing: 14, inset: 3 }],
  },
  banked: {
    setPieces: [],
    signLabel: "Banked",
    arrangements: [{ shape: "bank" as const, piece: "ticket-machine", count: 4, inset: 1 }],
  },
  overbanked: {
    setPieces: [],
    signLabel: "Overbanked",
    arrangements: [{ shape: "bank" as const, piece: "ticket-machine", count: 40, inset: 1 }],
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

await test("a colonnade is one line along each long wall in pairs about the center, with no pillar in a door gap", () => {
  const closed = arrange(specOf(room("hall", "colonnaded", 100, 40))).pieces;
  assert.ok(closed.length >= 8, "the colonnade is placed");
  for (const wallSign of [-1, 1]) {
    const line = closed.filter((piece) => Math.sign(piece.pivot.z) === wallSign);
    assert.equal(line.length % 2, 0, "an even count per line");
    assert.equal(new Set(line.map((piece) => piece.pivot.z)).size, 1, "one line per wall");
    assert.ok(
      line.every((piece) => piece.pivot.x !== 0),
      "no pillar on the center line",
    );
    for (const piece of line) {
      assert.ok(
        line.some((other) => Math.abs(other.pivot.x + piece.pivot.x) < 1e-9),
        `pillar at x ${String(piece.pivot.x)} has a mirror`,
      );
    }
  }
  assert.equal(closed.filter((piece) => piece.pivot.z < 0).length, closed.length / 2);
  const gapped = arrange(
    specOf(room("hall", "colonnaded", 100, 40, { doors: [{ side: "south", offset: 21 }] })),
  ).pieces;
  const south = gapped.filter((piece) => piece.pivot.z > 0);
  assert.ok(gapped.length > south.length && south.length > 0 && south.length < gapped.length / 2);
  assert.ok(
    south.every((piece) => Math.abs(piece.pivot.x - 21) > 3 + piece.size.x / 2),
    "clear of the south door lane",
  );
});

await test("a colonnade runs along the long axis of a deep room too", () => {
  const { pieces } = arrange(specOf(room("hall", "colonnaded", 40, 100)));
  assert.ok(pieces.length >= 8);
  assert.ok(pieces.every((piece) => Math.abs(piece.pivot.x) > 10 && piece.pivot.z !== 0));
});

await test("a bank abuts its pieces, centered on the first doorless short wall and facing into the room", () => {
  const spec = specOf(room("hall", "banked", 100, 40));
  const bank = arrange(spec).pieces;
  assert.equal(bank.length, 4);
  assert.ok(
    bank.every((piece) => piece.yaw === 90 && piece.pivot.x > 0),
    "east wall, facing west",
  );
  const sorted = bank.toSorted((first, second) => first.pivot.z - second.pivot.z);
  for (const [index, piece] of sorted.entries()) {
    const next = sorted[index + 1];
    if (next !== undefined) {
      const gap = footprint(next)[2] - footprint(piece)[3];
      assert.ok(Math.abs(gap) < 1e-6, `pieces ${String(index)} and ${String(index + 1)} abut`);
    }
  }
  const first = sorted[0];
  const last = sorted[3];
  assert.ok(first !== undefined && last !== undefined);
  const center = (footprint(first)[2] + footprint(last)[3]) / 2;
  assert.ok(Math.abs(center) < 1e-6, "centered on the wall");
});

await test("a bank skips a short wall with a door, and falls back to a doorless long wall", () => {
  const westOnly = specOf(
    room("hall", "banked", 100, 40, { doors: [{ side: "east", offset: 0 }] }),
  );
  const west = arrange(westOnly).pieces;
  assert.ok(west.length === 4 && west.every((piece) => piece.pivot.x < 0 && piece.yaw === 270));
  const longWall = specOf(
    room("hall", "banked", 100, 40, {
      doors: [
        { side: "east", offset: 0 },
        { side: "west", offset: 0 },
        { side: "south", offset: 0 },
      ],
    }),
  );
  const north = arrange(longWall).pieces;
  assert.ok(north.length === 4 && north.every((piece) => piece.pivot.z < 0 && piece.yaw === 180));
});

await test("a bank places all of its pieces or none, and warns when it places none", () => {
  const tooMany = arrange(specOf(room("hall", "overbanked", 100, 40)));
  assert.equal(tooMany.pieces.length, 0);
  assert.equal(tooMany.warnings.length, 1);
  const walled = specOf(
    room("hall", "banked", 100, 40, {
      doors: ["north", "south", "east", "west"].map((side) => ({ side, offset: 0 })),
    }),
  );
  assert.equal(arrange(walled).pieces.length, 0);
  const blocked = specOf(
    room("hall", "banked", 100, 40, { doors: [{ side: "south", offset: 0 }], spawn: true }),
  );
  assert.equal(arrange(blocked).pieces.length, 4, "a spawn pad off the wall leaves the bank");
});
