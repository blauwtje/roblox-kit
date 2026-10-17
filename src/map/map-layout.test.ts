import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { createSeededRandom } from "../shared/seeded-random.ts";
import { layoutMap, solveRoomGraph } from "./map-layout.ts";
import type { PartRecord } from "./map-layout.ts";
import { graphMapSpecSchema, mapSpecSchema } from "./map-spec.ts";

const threeRoomInput = {
  mapId: "three-rooms",
  rooms: [
    {
      name: "start",
      x: 0,
      z: 0,
      width: 40,
      depth: 40,
      spawn: true,
      doors: [{ side: "east", offset: 0 }],
    },
    {
      name: "hall",
      x: 40,
      z: 0,
      width: 40,
      depth: 40,
      doors: [{ side: "west" }, { side: "north", offset: 5 }],
    },
    { name: "vault", x: 40, z: -40, width: 40, depth: 40, doors: [{ side: "south", offset: 5 }] },
  ],
  terrain: [
    {
      shape: "block",
      center: { x: 0, y: -10, z: 0 },
      size: { x: 200, y: 20, z: 200 },
      material: "Grass",
    },
    { shape: "ball", center: { x: 60, y: -5, z: 60 }, radius: 8, material: "Water" },
  ],
};

function layoutOf(input: unknown) {
  return layoutMap(mapSpecSchema.parse(input));
}

function partNamed(parts: PartRecord[], name: string): PartRecord {
  const part = parts.find((candidate) => candidate.name === name);
  assert.ok(part, `part ${name} exists`);
  return part;
}

function overlapDepth(first: PartRecord, second: PartRecord): number {
  const axes = ["x", "y", "z"] as const;
  return Math.min(
    ...axes.map(
      (axis) =>
        (first.size[axis] + second.size[axis]) / 2 -
        Math.abs(first.position[axis] - second.position[axis]),
    ),
  );
}

await test("the same spec lays out to the same unique parts and terrain fills in order", () => {
  const first = layoutOf(threeRoomInput);
  assert.deepEqual(first, layoutOf(structuredClone(threeRoomInput)));
  assert.equal(new Set(first.parts.map((part) => part.name)).size, first.parts.length);
  assert.deepEqual(first.terrainFills, mapSpecSchema.parse(threeRoomInput).terrain);
});

await test("a room gets a floor just above y = 0, walls on it and a spawn pad at the center", () => {
  const { parts } = layoutOf({
    mapId: "one",
    rooms: [{ name: "box", x: 10, z: 20, width: 30, depth: 20, spawn: true }],
  });
  const floor = partNamed(parts, "box-floor");
  const floorTop = floor.position.y + floor.size.y / 2;
  assert.ok(floorTop > 0 && floorTop < config.overlapToleranceStuds);
  assert.deepEqual(floor.size, { x: 30, y: config.defaultWallThicknessStuds, z: 20 });
  const north = partNamed(parts, "box-wall-north-1");
  assert.deepEqual(north.position, { x: 10, y: 6, z: 10.5 });
  assert.deepEqual(north.size, { x: 30, y: config.defaultWallHeightStuds, z: 1 });
  const spawn = partNamed(parts, "box-spawn");
  assert.deepEqual(spawn.position, { x: 10, y: 0.5, z: 20 });
  assert.equal(parts.filter((part) => part.kind === "wall").length, 4);
});

await test("a door leaves a gap of its width, and at the wall end leaves one stretch", () => {
  const { parts } = layoutOf({
    mapId: "door",
    rooms: [
      { name: "box", x: 0, z: 0, width: 40, depth: 40, doors: [{ side: "south", offset: 4 }] },
    ],
  });
  const left = partNamed(parts, "box-wall-south-1");
  const right = partNamed(parts, "box-wall-south-2");
  const gap = right.position.x - right.size.x / 2 - (left.position.x + left.size.x / 2);
  assert.equal(gap, config.defaultDoorWidthStuds);
  const corner = layoutOf({
    mapId: "corner",
    doorWidth: 6,
    rooms: [
      { name: "box", x: 0, z: 0, width: 40, depth: 40, doors: [{ side: "north", offset: -17 }] },
    ],
  }).parts.filter((part) => part.name.startsWith("box-wall-north"));
  assert.deepEqual(
    corner.map((part) => part.size.x),
    [34],
  );
});

await test("room settings override map settings, which override the defaults", () => {
  const { parts } = layoutOf({
    mapId: "styled",
    wallMaterial: "Wood",
    wallHeight: 20,
    rooms: [
      { name: "plain", x: 0, z: 0, width: 20, depth: 20 },
      { name: "tall", x: 30, z: 0, width: 20, depth: 20, wallHeight: 30, floorMaterial: "Marble" },
    ],
  });
  assert.equal(partNamed(parts, "plain-wall-north-1").material, "Wood");
  assert.equal(partNamed(parts, "plain-wall-north-1").size.y, 20);
  assert.equal(partNamed(parts, "tall-wall-north-1").size.y, 30);
  assert.equal(partNamed(parts, "tall-floor").material, "Marble");
  assert.equal(partNamed(parts, "plain-floor").material, config.defaultFloorMaterial);
});

await test("a door or room that does not fit is rejected naming the room", () => {
  const box = { name: "box", x: 0, z: 0, width: 40, depth: 40 };
  const overlapping = [
    { side: "east", offset: 0 },
    { side: "east", offset: 3 },
  ];
  const cases: [object, RegExp][] = [
    [{ ...box, doors: [{ side: "north", offset: 19 }] }, /Room "box": the north door/],
    [{ ...box, doors: overlapping }, /Room "box": the east door/],
    [{ ...box, width: 2 }, /Room "box" is 2 by 40 studs/],
  ];
  for (const [badRoom, message] of cases) {
    assert.throws(() => layoutOf({ mapId: "bad", rooms: [badRoom] }), message);
  }
});

await test("a style's surfaces paint parts by role, with the accent pad falling back to the floor", () => {
  const plain = layoutOf(threeRoomInput).parts;
  assert.equal(partNamed(plain, "start-floor").role, "floor");
  assert.equal(partNamed(plain, "start-wall-north-1").role, "wall");
  assert.equal(partNamed(plain, "start-spawn").role, "accent");
  const floor = { color: "#112233", material: "Slate" };
  const wall = { color: "#445566", material: "Brick" };
  const accent = { color: "#d9a441", material: "Neon" };
  const spec = mapSpecSchema.parse(threeRoomInput);
  const styled = layoutMap(spec, { floor, wall, accent }).parts;
  assert.equal(partNamed(styled, "hall-floor").color, "#112233");
  assert.equal(partNamed(styled, "hall-wall-north-1").material, "Brick");
  assert.deepEqual(
    [partNamed(styled, "start-spawn").color, partNamed(styled, "start-spawn").material],
    ["#d9a441", "Neon"],
  );
  const noAccent = partNamed(layoutMap(spec, { floor, wall }).parts, "start-spawn");
  assert.deepEqual([noAccent.color, noAccent.material], ["#112233", "Slate"]);
  const mapMaterial = layoutMap(mapSpecSchema.parse({ ...threeRoomInput, wallMaterial: "Wood" }), {
    floor,
    wall,
  });
  assert.equal(partNamed(mapMaterial.parts, "hall-wall-north-1").material, "Wood");
});

await test("ceilings are opt-in, one slab per room resting on the walls, in the style's ceiling surface", () => {
  assert.equal(
    layoutOf(threeRoomInput).parts.some((part) => part.kind === "ceiling"),
    false,
  );
  const spec = mapSpecSchema.parse({ ...threeRoomInput, wallHeight: 10, wallThickness: 2 });
  const surfaces = {
    floor: { color: "#112233" },
    wall: { color: "#445566" },
    ceiling: { color: "#778899", material: "Metal" },
  };
  const { parts } = layoutMap(spec, surfaces, { ceilings: true });
  const ceilings = parts.filter((part) => part.kind === "ceiling");
  assert.deepEqual(
    ceilings.map((part) => part.name),
    ["start", "hall", "vault"].map((room) => `${room}${config.ceilingNameSuffix}`),
  );
  const ceiling = partNamed(parts, "hall-ceiling");
  assert.deepEqual([ceiling.color, ceiling.material], ["#778899", "Metal"]);
  assert.deepEqual(ceiling.size, { x: 40, y: 2, z: 40 });
  const wall = partNamed(parts, "hall-wall-north-1");
  assert.equal(ceiling.position.y - ceiling.size.y / 2, wall.position.y + wall.size.y / 2);
});

await test("a flush spawn pad is thin on the floor top in the floor's surface, otherwise it is raised", () => {
  const surfaces = {
    floor: { color: "#112233", material: "Slate" },
    wall: { color: "#445566" },
    accent: { color: "#d9a441", material: "Neon" },
  };
  const spec = mapSpecSchema.parse(threeRoomInput);
  const { parts } = layoutMap(spec, surfaces, { flushSpawn: true });
  const spawn = partNamed(parts, "start-spawn");
  const floor = partNamed(parts, "start-floor");
  assert.deepEqual(
    [spawn.role, spawn.color, spawn.material],
    [floor.role, floor.color, floor.material],
  );
  assert.equal(spawn.size.y, config.flushSpawnThicknessStuds);
  const padBottom = spawn.position.y - spawn.size.y / 2;
  assert.ok(Math.abs(padBottom - (floor.position.y + floor.size.y / 2)) < 1e-9);
  const raised = layoutMap(spec, undefined, { flushSpawn: false }).parts;
  assert.deepEqual(partNamed(raised, "start-spawn").position, { x: 0, y: 0.5, z: 0 });
});

await test("a header over a lower door spans between the wall stretches beside it, which carry it", () => {
  const { parts } = layoutOf({
    mapId: "tall",
    rooms: [
      {
        name: "tall",
        x: 0,
        z: 0,
        width: 40,
        depth: 40,
        wallHeight: 24,
        doors: [{ side: "north", offset: 0, height: 16 }],
      },
    ],
  });
  const header = partNamed(parts, `tall${config.wallNameInfix}north-header-1`);
  const west = partNamed(parts, `tall${config.wallNameInfix}north-1`);
  const east = partNamed(parts, `tall${config.wallNameInfix}north-2`);
  assert.equal(header.position.x - header.size.x / 2, west.position.x + west.size.x / 2);
  assert.equal(header.position.x + header.size.x / 2, east.position.x - east.size.x / 2);
  assert.equal(header.position.y - header.size.y / 2, 16);
  for (const stretch of [west, east]) {
    assert.equal(stretch.position.y - stretch.size.y / 2, 0);
    assert.ok(stretch.position.y + stretch.size.y / 2 >= header.position.y + header.size.y / 2);
  }
});

const graphRoom = (name: string, extra: object = {}) => ({ name, width: 40, depth: 40, ...extra });

function graphSpec(names: string[], edges: [string, string][], extra: object = {}) {
  return graphMapSpecSchema.parse({
    mapId: "graph",
    rooms: names.map((name) => graphRoom(name)),
    graph: { edges: edges.map(([a, b]) => ({ a, b })) },
    ...extra,
  });
}

function doorCenters(room: ReturnType<typeof solveRoomGraph>["rooms"][number]) {
  return room.doors.map((door) => ({
    side: door.side,
    world: door.offset + (door.side === "north" || door.side === "south" ? room.x : room.z),
  }));
}

function assertSolved(
  spec: ReturnType<typeof graphSpec>,
  solved: ReturnType<typeof solveRoomGraph>,
) {
  const byName = new Map(solved.rooms.map((room) => [room.name, room]));
  for (const [index, first] of solved.rooms.entries()) {
    for (const second of solved.rooms.slice(index + 1)) {
      const overlapX = 40 - Math.abs(first.x - second.x);
      const overlapZ = 40 - Math.abs(first.z - second.z);
      assert.ok(
        overlapX <= config.overlapToleranceStuds || overlapZ <= config.overlapToleranceStuds,
        `${first.name} overlaps ${second.name}`,
      );
    }
  }
  const opposite = { north: "south", south: "north", east: "west", west: "east" } as const;
  for (const edge of spec.graph.edges) {
    const first = byName.get(edge.a);
    const second = byName.get(edge.b);
    assert.ok(first && second);
    const shared = doorCenters(first).filter((door) =>
      doorCenters(second).some(
        (other) => other.side === opposite[door.side] && Math.abs(other.world - door.world) < 1e-9,
      ),
    );
    assert.equal(shared.length, 1, `${edge.a} and ${edge.b} share one matching door pair`);
  }
}

await test("a room graph, with or without a loop, solves to touching rooms with matching doors", () => {
  const chain = graphSpec(
    ["a", "b", "c"],
    [
      ["a", "b"],
      ["b", "c"],
    ],
  );
  const solved = solveRoomGraph(chain);
  assert.equal(solved.rooms.length, 3);
  assertSolved(chain, solved);
  const loop = graphSpec(
    ["a", "b", "c", "d"],
    [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "a"],
    ],
  );
  assertSolved(loop, solveRoomGraph(loop));
  assert.deepEqual(layoutMap(solveRoomGraph(chain)), layoutMap(chain));
});

await test("the same graph and seed give the same layout, other seeds may differ", () => {
  const edges: [string, string][] = [
    ["a", "b"],
    ["a", "c"],
    ["a", "d"],
  ];
  const names = ["a", "b", "c", "d"];
  const first = solveRoomGraph(graphSpec(names, edges, { seed: 7 }));
  assert.deepEqual(solveRoomGraph(graphSpec(names, edges, { seed: 7 })), first);
  const layouts = new Set(
    [1, 2, 3, 4, 5, 6].map((seed) =>
      JSON.stringify(solveRoomGraph(graphSpec(names, edges, { seed }))),
    ),
  );
  assert.ok(layouts.size > 1);
});

await test("graphs no layout can honor are rejected", () => {
  const star = ["hub", "n", "e", "s", "w", "extra"];
  const starEdges = star.slice(1).map((name): [string, string] => ["hub", name]);
  assert.throws(() => solveRoomGraph(graphSpec(star, starEdges)), /No layout fits/);
  const names = Array.from({ length: 9 }, (_, index) => `r${String(index)}`);
  const edges: [string, string][] = [["r0", "r8"]];
  for (let index = 0; index < 9; index += 1) {
    if (index % 3 < 2) {
      edges.push([`r${String(index)}`, `r${String(index + 1)}`]);
    }
    if (index < 6) {
      edges.push([`r${String(index)}`, `r${String(index + 3)}`]);
    }
  }
  assert.throws(() => solveRoomGraph(graphSpec(names, edges)), /No layout fits/);
  assert.throws(
    () => solveRoomGraph(graphSpec(["a", "b", "c"], [["a", "b"]])),
    /not connected.*"c"/,
  );
  const joined = (doorWidth: number, other = doorWidth) =>
    graphMapSpecSchema.parse({
      mapId: "graph",
      rooms: [graphRoom("a", { doorWidth }), graphRoom("b", { doorWidth: other })],
      graph: { edges: [{ a: "a", b: "b" }] },
    });
  assert.throws(() => solveRoomGraph(joined(8, 6)), /same doorWidth/);
  assert.throws(() => solveRoomGraph(joined(40)), /No layout fits/);
});

function randomTree(seed: number): { names: string[]; edges: [string, string][] } {
  const random = createSeededRandom(seed);
  const names = Array.from({ length: 3 + Math.floor(random() * 4) }, (_, i) => `r${String(i)}`);
  const degree = new Map<string, number>();
  const edges = names.slice(1).map((name, index): [string, string] => {
    const open = names.slice(0, index + 1).filter((other) => (degree.get(other) ?? 0) < 3);
    const parent = open[Math.floor(random() * open.length)] ?? "r0";
    degree.set(parent, (degree.get(parent) ?? 0) + 1);
    return [parent, name];
  });
  return { names, edges };
}

function solvedPartsOrUndefined(seed: number): PartRecord[] | undefined {
  const { names, edges } = randomTree(seed);
  try {
    return layoutMap(solveRoomGraph(graphSpec(names, edges, { seed })), undefined, {
      ceilings: true,
    }).parts;
  } catch (error) {
    assert.match(String(error), /No layout fits/);
    return undefined;
  }
}

function assertNoCrossRoomOverlap(parts: PartRecord[], seed: number) {
  const pairs = parts.flatMap((first, index) =>
    parts.slice(index + 1).map((second): [PartRecord, PartRecord] => [first, second]),
  );
  for (const [first, second] of pairs.filter(([a, b]) => a.room !== b.room)) {
    const message = `seed ${String(seed)}: ${first.name} overlaps ${second.name}`;
    assert.ok(overlapDepth(first, second) <= config.overlapToleranceStuds, message);
  }
}

await test("parts of different rooms never overlap in any solved random room graph", () => {
  const seeds = Array.from({ length: 40 }, (_, index) => index + 1);
  const solved = seeds.flatMap((seed) => {
    const parts = solvedPartsOrUndefined(seed);
    return parts ? [{ seed, parts }] : [];
  });
  for (const { seed, parts } of solved) {
    assertNoCrossRoomOverlap(parts, seed);
  }
  assert.ok(solved.length >= 20, `only ${String(solved.length)} random graphs were solvable`);
});
