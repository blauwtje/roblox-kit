import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodeImage } from "./decode-image.ts";
import {
  depthFixtureColumns,
  depthFixtureName,
  depthFixtureRows,
  depthMissStuds,
  writeDepthFixture,
} from "./depth-fixture.ts";

const image = { width: 1036, height: 732, data: new Uint8Array(1036 * 732 * 4).fill(200) };
const grid = (cell: { distanceStuds: number } | null) =>
  Array.from({ length: depthFixtureRows }, () =>
    Array.from({ length: depthFixtureColumns }, () => cell),
  );

await test("depthFixtureName joins benchmark, zone and view", () => {
  assert.equal(depthFixtureName("train-station", "hall", "a"), "train-station-hall-a");
});

await test("writeDepthFixture writes a 518 px jpeg and a 32 by 18 truth with misses at the far distance", async () => {
  const root = await mkdtemp(join(tmpdir(), "depth-fixture-"));
  const [first = [], ...rest] = grid({ distanceStuds: 12.5 });
  const rows = [[null, ...first.slice(1)], ...rest];
  const folder = await writeDepthFixture({ root, name: "bench-hall-a", image, rows });
  assert.equal(folder, join(root, "bench-hall-a"));
  const decoded = decodeImage(await readFile(join(folder, "image.jpg")));
  assert.deepEqual([decoded.width, decoded.height], [518, 366]);
  const truth = JSON.parse(await readFile(join(folder, "truth.json"), "utf8")) as {
    cells: number[][];
  };
  assert.equal(truth.cells.length, 18);
  assert.equal(truth.cells[0]?.length, 32);
  assert.equal(truth.cells[0][0], depthMissStuds);
  assert.equal(truth.cells[1]?.[1], 12.5);
});

await test("writeDepthFixture rejects a truth grid of the wrong size", async () => {
  const root = await mkdtemp(join(tmpdir(), "depth-fixture-"));
  await assert.rejects(
    writeDepthFixture({ root, name: "x", image, rows: [[{ distanceStuds: 1 }]] }),
    /not 32 by 18/,
  );
});
