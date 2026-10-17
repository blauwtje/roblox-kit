import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import {
  graphMapSpecSchema,
  mapSpecSchema,
  measureRoom,
  relationMapSpecSchema,
} from "./map-spec.ts";

const room = { name: "hall", x: 0, z: 0, width: 20, depth: 20 };
const minimalSpec = { mapId: "m", rooms: [room] };
const relation = { to: "hall", direction: "east", hallwayLength: 10, hallwayWidth: 10 };
const relatedRoom = { name: "vault", width: 20, depth: 20, relation };
const pair = [
  { name: "a", width: 20, depth: 20 },
  { name: "b", width: 20, depth: 20 },
];

await test("a spec keeps its style, seed, objectives and budget, and fills the rest from config", () => {
  const bare = mapSpecSchema.parse(minimalSpec);
  assert.deepEqual(
    [bare.style, bare.seed, bare.objectives, bare.rooms[0]?.roomType],
    [undefined, undefined, undefined, undefined],
  );
  assert.deepEqual(bare.performanceBudget, {
    maxDrawCalls: config.maxDrawCalls,
    maxTriangles: config.maxTriangles,
  });
  const objectives = [{ name: "flag", x: 1, y: 2, z: 3 }];
  const spec = mapSpecSchema.parse({
    ...minimalSpec,
    seed: 0,
    objectives,
    performanceBudget: { maxDrawCalls: 500 },
    style: { preset: "cozy-town", overrides: { sizeRules: { minDoorwayWidth: 8 } } },
    rooms: [{ ...room, roomType: "platform" }],
  });
  assert.equal(spec.seed, 0);
  assert.deepEqual(spec.objectives, objectives);
  assert.deepEqual(spec.performanceBudget, {
    maxDrawCalls: 500,
    maxTriangles: config.maxTriangles,
  });
  assert.deepEqual(spec.style?.overrides, { sizeRules: { minDoorwayWidth: 8 } });
  assert.equal(spec.rooms[0]?.roomType, "platform");
});

const invalidSpecs: [string, object][] = [
  ["a style without a preset", { style: {} }],
  ["an empty preset name", { style: { preset: "" } }],
  ["an unknown style key", { style: { preset: "a", extra: 1 } }],
  [
    "an out-of-range override",
    { style: { preset: "a", overrides: { lighting: { Atmosphere: { Density: 2 } } } } },
  ],
  ["a negative seed", { seed: -1 }],
  ["a fractional seed", { seed: 1.5 }],
  ["a string seed", { seed: "1" }],
  ["an unnamed objective", { objectives: [{ name: "", x: 0, y: 0, z: 0 }] }],
  ["an objective without z", { objectives: [{ name: "a", x: 0, y: 0 }] }],
  ["an objective with an extra key", { objectives: [{ name: "a", x: 0, y: 0, z: 0, extra: 1 }] }],
  ["a zero draw call budget", { performanceBudget: { maxDrawCalls: 0 } }],
  ["a negative triangle budget", { performanceBudget: { maxTriangles: -1 } }],
  ["a fractional draw call budget", { performanceBudget: { maxDrawCalls: 1.5 } }],
  ["an unknown budget key", { performanceBudget: { extra: 1 } }],
  ["an empty room type", { rooms: [{ ...room, roomType: "" }] }],
  ["a relation in a placed-only spec", { rooms: [relatedRoom] }],
  ["a duplicate room name", { rooms: [room, room] }],
  ["no rooms", { rooms: [] }],
  ["a negative room width", { rooms: [{ ...room, width: -5 }] }],
  ["an unknown top-level key", { extra: 1 }],
];

await test("a map spec rejects invalid input", () => {
  for (const [label, patch] of invalidSpecs) {
    assert.equal(mapSpecSchema.safeParse({ ...minimalSpec, ...patch }).success, false, label);
  }
});

await test("a room takes x and z or a relation, and the relation is validated", () => {
  const spec = relationMapSpecSchema.parse({ mapId: "m", rooms: [room, relatedRoom] });
  const [placed, related] = spec.rooms;
  assert.ok(placed && "x" in placed);
  assert.ok(related && "relation" in related);
  assert.deepEqual(related.relation, relation);
  const badRooms: [string, object[]][] = [
    ["x/z and a relation", [{ ...room, relation }]],
    ["only x", [{ name: "a", x: 1, width: 20, depth: 20 }]],
    ["only z", [{ name: "a", z: 1, width: 20, depth: 20 }]],
    ["neither", [{ name: "a", width: 20, depth: 20 }]],
    ["a duplicate name", [room, { ...relatedRoom, name: "hall" }]],
  ];
  const badRelations = [
    { ...relation, to: "" },
    { ...relation, direction: "up" },
    { ...relation, hallwayLength: 0 },
    { ...relation, hallwayWidth: -1 },
    { ...relation, extra: 1 },
    { to: "hall", direction: "east", hallwayLength: 10 },
  ];
  for (const bad of badRelations) {
    badRooms.push([`relation ${JSON.stringify(bad)}`, [room, { ...relatedRoom, relation: bad }]]);
  }
  for (const [label, rooms] of badRooms) {
    assert.equal(relationMapSpecSchema.safeParse({ mapId: "m", rooms }).success, false, label);
  }
});

await test("a graph spec's rooms have no center and its edges name two different rooms", () => {
  const parse = (edges: object[], rooms: object[] = pair) =>
    graphMapSpecSchema.safeParse({ mapId: "m", rooms, graph: { edges } });
  assert.equal(parse([{ a: "a", b: "b" }]).success, true);
  assert.equal(parse([{ a: "a", b: "missing" }]).success, false);
  assert.equal(parse([{ a: "a", b: "a" }]).success, false);
  assert.equal(
    parse([{ a: "a", b: "b" }], [{ ...pair[0], x: 0, z: 0 }, pair[1] as object]).success,
    false,
  );
  assert.equal(parse([], [pair[0] as object, pair[0] as object]).success, false);
  assert.equal(graphMapSpecSchema.safeParse({ mapId: "m", rooms: pair }).success, false);
});

await test("measureRoom lets a room's sizes win over the map's, which win over the config defaults", () => {
  assert.deepEqual(measureRoom({}, {}), {
    wallHeight: config.defaultWallHeightStuds,
    wallThickness: config.defaultWallThicknessStuds,
    doorWidth: config.defaultDoorWidthStuds,
  });
  assert.deepEqual(measureRoom({ wallHeight: 20, doorWidth: 9 }, { wallHeight: 30 }), {
    wallHeight: 30,
    wallThickness: config.defaultWallThicknessStuds,
    doorWidth: 9,
  });
});

await test("a spec defaults the detail switches to false and checks npcs strictly", () => {
  const parsed = mapSpecSchema.parse(minimalSpec);
  assert.equal(parsed.npcs, undefined);
  assert.deepEqual([parsed.clutter, parsed.signage, parsed.motion], [false, false, false]);
  const withNpcs = mapSpecSchema.parse({
    ...minimalSpec,
    npcs: { density: 0.5, seed: 3, maxTotal: 10 },
    motion: true,
  });
  assert.equal(withNpcs.npcs?.maxTotal, 10);
  assert.equal(withNpcs.motion, true);
  for (const npcs of [
    { density: 1.5 },
    { density: 0.5, extra: 1 },
    { density: 0.5, maxTotal: 0 },
  ]) {
    assert.equal(mapSpecSchema.safeParse({ ...minimalSpec, npcs }).success, false);
  }
});
