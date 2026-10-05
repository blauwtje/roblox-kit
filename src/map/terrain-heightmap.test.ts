import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { mapSpecSchema } from "./map-spec.ts";
import { generateHeightmap, solidVoxelCount, terrainChunks } from "./terrain-heightmap.ts";

const room = { name: "hall", x: 0, z: 0, width: 20, depth: 20 };

function heightmapSpec(overrides: Record<string, unknown> = {}) {
  return mapSpecSchema.parse({
    mapId: "hills",
    rooms: [room],
    terrain: [
      {
        shape: "heightmap",
        center: { x: 0, y: -12, z: -2 },
        size: { x: 160, y: 24, z: 140 },
        material: "Ground",
        ...overrides,
      },
    ],
  });
}

function heightmapFill(overrides: Record<string, unknown> = {}) {
  const fill = heightmapSpec(overrides).terrain[0];
  assert.ok(fill && fill.shape === "heightmap");
  return fill;
}

await test("the same seed gives the same heights and another seed gives other heights", () => {
  const first = generateHeightmap(heightmapFill({ seed: 5 }), 1);
  const again = generateHeightmap(heightmapFill({ seed: 5 }), 1);
  const other = generateHeightmap(heightmapFill({ seed: 6 }), 1);
  assert.deepEqual(first, again);
  assert.notDeepEqual(first.heights, other.heights);
});

await test("heights fill the box from its bottom to its height, one per voxel column", () => {
  const { columns, rows, heights } = generateHeightmap(heightmapFill(), 1);
  assert.equal(columns, 40);
  assert.equal(rows, 35);
  assert.equal(heights.length, columns * rows);
  assert.equal(Math.min(...heights), 0);
  assert.ok(Math.abs(Math.max(...heights) - 24) < 1e-9);
});

await test("erosion reshapes the noise and 0 droplets leaves it", () => {
  const raw = generateHeightmap(heightmapFill({ erosion: 0 }), 1);
  const eroded = generateHeightmap(heightmapFill({ erosion: 4 }), 1);
  assert.notDeepEqual(raw.heights, eroded.heights);
  assert.deepEqual(raw, generateHeightmap(heightmapFill({ erosion: 0 }), 1));
});

await test("chunks tile the box, stay under the Luau limit and use every layer from sand to snow", () => {
  const chunks = terrainChunks(heightmapFill(), 1);
  assert.equal(chunks.length, 4);
  const columns = chunks.reduce((total, chunk) => total + chunk.surface.length, 0);
  assert.equal(columns, 40 * 35);
  for (const chunk of chunks) {
    assert.ok(JSON.stringify(chunk).length < config.executeLuauMaxResultChars);
    assert.equal(chunk.origin.y, -24);
    assert.equal(chunk.voxelsY, 6);
    assert.equal(chunk.surface.length, chunk.columns * chunk.rows);
  }
  const used = new Set(chunks.flatMap((chunk) => chunk.surface));
  assert.ok(used.has(0) && used.has(3), "sand and snow columns exist");
  assert.ok(used.size >= 3, "at least three surface layers are used");
  assert.ok(solidVoxelCount(chunks) > 0);
});

await test("a box off the voxel grid is rejected", () => {
  assert.throws(() => heightmapSpec({ size: { x: 161, y: 24, z: 140 } }), /voxel grid/);
  assert.throws(() => heightmapSpec({ center: { x: 1, y: -12, z: -2 } }), /voxel grid/);
});
