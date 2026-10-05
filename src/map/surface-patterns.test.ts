import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededRandom } from "../shared/seeded-random.ts";
import { mapSpecSchema } from "./map-spec.ts";
import { layoutMap } from "./map-layout.ts";
import { buildRoomDetails } from "./room-details.ts";
import { defaultTileKinds, solveTileGrid, surfacePatternTiles } from "./surface-patterns.ts";
import type { TileKind } from "./surface-patterns.ts";

const room = { name: "hall", x: 10, z: 20, width: 40, depth: 30 };
const input = { room, roomIndex: 0, wallThickness: 1, wallHeight: 12, seed: 7 };

function solveDefault(columns: number, rows: number, seed: number) {
  const solution = solveTileGrid(columns, rows, defaultTileKinds, createSeededRandom(seed));
  assert.ok(solution, "the default tile set covers the grid");
  return solution;
}

await test("every neighboring pair in a solved grid is allowed by the tile set", () => {
  for (const seed of [0, 1, 2, 3, 42]) {
    const { tiles } = solveDefault(9, 7, seed);
    for (const [row, line] of tiles.entries()) {
      for (const [column, index] of line.entries()) {
        const kind = defaultTileKinds[index];
        assert.ok(kind);
        for (const other of [tiles[row]?.[column + 1], tiles[row + 1]?.[column]]) {
          if (other === undefined) continue;
          assert.ok(kind.neighbors.includes(defaultTileKinds[other]?.id ?? ""));
        }
      }
    }
  }
});

await test("accent tiles never touch each other or bare floor", () => {
  const { tiles } = solveDefault(12, 12, 5);
  const accent = defaultTileKinds.findIndex((kind) => kind.id === "accent");
  const plain = defaultTileKinds.findIndex((kind) => kind.id === "plain");
  for (const [row, line] of tiles.entries()) {
    for (const [column, index] of line.entries()) {
      if (index !== accent) continue;
      for (const other of [
        tiles[row]?.[column + 1],
        tiles[row]?.[column - 1],
        tiles[row + 1]?.[column],
        tiles[row - 1]?.[column],
      ]) {
        assert.notEqual(other, accent);
        assert.notEqual(other, plain);
      }
    }
  }
});

await test("the same seed gives the same tiles and another seed other ones", () => {
  assert.deepEqual(solveDefault(10, 10, 3), solveDefault(10, 10, 3));
  assert.notDeepEqual(solveDefault(10, 10, 3).tiles, solveDefault(10, 10, 4).tiles);
});

await test("a tile set that cannot cover the grid gives no solution", () => {
  const lonely: TileKind[] = [{ id: "a", weight: 1, neighbors: [] }];
  assert.equal(solveTileGrid(3, 3, lonely, createSeededRandom(0)), undefined);
});

await test("a tile set naming an unknown neighbor is rejected", () => {
  const broken: TileKind[] = [{ id: "a", weight: 1, neighbors: ["ghost"] }];
  assert.throws(() => solveTileGrid(2, 2, broken, createSeededRandom(0)), /unknown neighbor/);
});

await test("floor tiles lie on the floor inside the walls and ceiling tiles hang under the ceiling", () => {
  const floor = surfacePatternTiles({ ...input, surface: "floor" });
  const ceiling = surfacePatternTiles({ ...input, surface: "ceiling" });
  assert.ok(floor.length > 0);
  assert.ok(ceiling.length > 0);
  for (const tile of [...floor, ...ceiling]) {
    assert.ok(Math.abs(tile.position.x - room.x) + tile.size.x / 2 <= room.width / 2 - 1);
    assert.ok(Math.abs(tile.position.z - room.z) + tile.size.z / 2 <= room.depth / 2 - 1);
  }
  for (const tile of floor) assert.ok(tile.position.y < 1);
  for (const tile of ceiling) assert.ok(tile.position.y > 11);
  assert.notDeepEqual(
    floor.map((tile) => tile.name),
    ceiling.map((tile) => tile.name),
  );
});

await test("a room too small for a 2 by 2 grid gets no tiles", () => {
  const small = { ...room, width: 10, depth: 10 };
  assert.deepEqual(surfacePatternTiles({ ...input, room: small, surface: "floor" }), []);
});

await test("buildRoomDetails adds tile details only for the surfaces asked", () => {
  const spec = mapSpecSchema.parse({
    mapId: "tiles",
    rooms: [{ name: "hall", x: 0, z: 0, width: 40, depth: 30 }],
  });
  const { parts } = layoutMap(spec);
  const surfaces = {
    trim: { color: "#112233", material: "Wood" },
    accent: { color: "#aa5500", material: "Neon" },
  } as const;
  const tilesOf = (patterns: ("floor" | "ceiling")[]) =>
    buildRoomDetails(spec, parts, surfaces, patterns).filter((detail) => detail.kind === "tile");
  assert.equal(tilesOf([]).length, 0);
  const floorTiles = tilesOf(["floor"]);
  assert.ok(floorTiles.length > 0);
  for (const tile of floorTiles) {
    assert.equal(tile.canCollide, false);
    assert.equal(tile.canQuery, false);
    assert.equal(tile.material, tile.role === "trim" ? "Wood" : "Neon");
  }
  assert.ok(tilesOf(["floor", "ceiling"]).length > floorTiles.length);
});
