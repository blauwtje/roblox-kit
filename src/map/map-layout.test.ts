import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
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

await test("the same spec lays out to the same parts and terrain fills", () => {
  const first = layoutOf(threeRoomInput);
  const second = layoutOf(structuredClone(threeRoomInput));
  assert.deepEqual(first, second);
  assert.equal(new Set(first.parts.map((part) => part.name)).size, first.parts.length);
});

await test("a room floor's top clears the ground plane y = 0 by less than the overlap tolerance", () => {
  const { parts } = layoutOf({
    mapId: "one",
    rooms: [{ name: "box", x: 10, z: 20, width: 30, depth: 20 }],
  });
  const floor = partNamed(parts, "box-floor");
  const floorTop = floor.position.y + floor.size.y / 2;
  assert.ok(floorTop > 0, `floor top ${String(floorTop)} is above the Baseplate top at y = 0`);
  assert.ok(
    floorTop < config.overlapToleranceStuds,
    "walls and props on y = 0 only touch the floor",
  );
});

await test("a room gets a floor topped at y = 0 plus the lift and walls standing on it with the config defaults", () => {
  const { parts } = layoutOf({
    mapId: "one",
    rooms: [{ name: "box", x: 10, z: 20, width: 30, depth: 20 }],
  });
  const floor = partNamed(parts, "box-floor");
  assert.deepEqual(floor.position, { x: 10, y: config.floorLiftStuds - 0.5, z: 20 });
  assert.deepEqual(floor.size, { x: 30, y: config.defaultWallThicknessStuds, z: 20 });
  assert.equal(floor.material, config.defaultFloorMaterial);
  const north = partNamed(parts, "box-wall-north-1");
  assert.deepEqual(north.position, { x: 10, y: 6, z: 10.5 });
  assert.deepEqual(north.size, { x: 30, y: config.defaultWallHeightStuds, z: 1 });
  assert.equal(north.material, config.defaultWallMaterial);
  const east = partNamed(parts, "box-wall-east-1");
  assert.deepEqual(east.position, { x: 24.5, y: 6, z: 20 });
  assert.deepEqual(east.size, { x: 1, y: 12, z: 18 });
  assert.equal(parts.length, 5);
});

await test("a door splits its wall into two stretches with a gap of the door width", () => {
  const { parts } = layoutOf({
    mapId: "door",
    rooms: [
      { name: "box", x: 0, z: 0, width: 40, depth: 40, doors: [{ side: "south", offset: 4 }] },
    ],
  });
  const left = partNamed(parts, "box-wall-south-1");
  const right = partNamed(parts, "box-wall-south-2");
  assert.deepEqual(left.position, { x: -10.5, y: 6, z: 19.5 });
  assert.deepEqual(left.size, { x: 19, y: 12, z: 1 });
  assert.deepEqual(right.position, { x: 14.5, y: 6, z: 19.5 });
  assert.deepEqual(right.size, { x: 11, y: 12, z: 1 });
  const gap = right.position.x - right.size.x / 2 - (left.position.x + left.size.x / 2);
  assert.equal(gap, config.defaultDoorWidthStuds);
});

await test("a door at the wall end leaves one stretch", () => {
  const { parts } = layoutOf({
    mapId: "corner",
    doorWidth: 6,
    rooms: [
      { name: "box", x: 0, z: 0, width: 40, depth: 40, doors: [{ side: "north", offset: -17 }] },
    ],
  });
  const north = parts.filter((part) => part.name.startsWith("box-wall-north"));
  assert.equal(north.length, 1);
  assert.deepEqual(north[0]?.size, { x: 34, y: 12, z: 1 });
});

await test("room and map settings override the defaults, room over map", () => {
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

await test("a spawn room gets a spawn pad on its floor at the room center", () => {
  const { parts } = layoutOf(threeRoomInput);
  const spawns = parts.filter((part) => part.kind === "spawn");
  assert.deepEqual(
    spawns.map((part) => part.name),
    ["start-spawn"],
  );
  assert.deepEqual(spawns[0]?.position, { x: 0, y: 0.5, z: 0 });
});

await test("terrain fills pass through in order", () => {
  const { terrainFills } = layoutOf(threeRoomInput);
  assert.deepEqual(terrainFills, mapSpecSchema.parse(threeRoomInput).terrain);
  assert.deepEqual(
    terrainFills.map((fill) => fill.shape),
    ["block", "ball"],
  );
});

await test("a door that does not fit the wall or overlaps another is rejected with the room name", () => {
  assert.throws(
    () =>
      layoutOf({
        mapId: "bad",
        rooms: [
          { name: "box", x: 0, z: 0, width: 40, depth: 40, doors: [{ side: "north", offset: 19 }] },
        ],
      }),
    /Room "box": the north door/,
  );
  assert.throws(
    () =>
      layoutOf({
        mapId: "bad",
        rooms: [
          {
            name: "box",
            x: 0,
            z: 0,
            width: 40,
            depth: 40,
            doors: [
              { side: "east", offset: 0 },
              { side: "east", offset: 3 },
            ],
          },
        ],
      }),
    /Room "box": the east door/,
  );
});

await test("a room no larger than its walls is rejected", () => {
  assert.throws(
    () => layoutOf({ mapId: "tiny", rooms: [{ name: "box", x: 0, z: 0, width: 2, depth: 40 }] }),
    /Room "box" is 2 by 40 studs/,
  );
});

await test("the schema rejects unknown keys, duplicate room names and empty maps", () => {
  assert.equal(mapSpecSchema.safeParse({ ...threeRoomInput, extra: 1 }).success, false);
  assert.equal(mapSpecSchema.safeParse({ mapId: "empty", rooms: [] }).success, false);
  const room = { name: "same", x: 0, z: 0, width: 20, depth: 20 };
  const duplicate = mapSpecSchema.safeParse({ mapId: "dup", rooms: [room, room] });
  assert.equal(duplicate.success, false);
  assert.equal(
    mapSpecSchema.safeParse({ mapId: "bad", rooms: [{ ...room, width: -5 }] }).success,
    false,
  );
});

await test("each part carries a surface role and the shipped default color when there is no style", () => {
  const { parts } = layoutOf(threeRoomInput);
  for (const part of parts) {
    assert.match(part.color, /^#[0-9a-f]{6}$/);
  }
  const floor = partNamed(parts, "start-floor");
  const wall = partNamed(parts, "start-wall-north-1");
  const spawn = partNamed(parts, "start-spawn");
  assert.equal(floor.role, "floor");
  assert.equal(wall.role, "wall");
  assert.equal(spawn.role, "accent");
  assert.notEqual(floor.color, wall.color);
});

await test("a style's surface colors replace the defaults by role", () => {
  const surfaces = { floor: { color: "#112233" }, wall: { color: "#445566" } };
  const { parts } = layoutMap(mapSpecSchema.parse(threeRoomInput), surfaces);
  assert.equal(partNamed(parts, "hall-floor").color, "#112233");
  assert.equal(partNamed(parts, "start-spawn").color, "#112233");
  assert.equal(partNamed(parts, "hall-wall-north-1").color, "#445566");
});

await test("a style's surface material fills in where the room and the map name none", () => {
  const surfaces = {
    floor: { color: "#112233", material: "Slate" },
    wall: { color: "#445566", material: "Brick" },
  };
  const input = { ...threeRoomInput, wallMaterial: "Wood" };
  const { parts } = layoutMap(mapSpecSchema.parse(input), surfaces);
  assert.equal(partNamed(parts, "hall-floor").material, "Slate");
  assert.equal(partNamed(parts, "start-spawn").material, "Slate");
  assert.equal(partNamed(parts, "hall-wall-north-1").material, "Wood");
  const withoutMapMaterial = layoutMap(mapSpecSchema.parse(threeRoomInput), surfaces);
  assert.equal(partNamed(withoutMapMaterial.parts, "hall-wall-north-1").material, "Brick");
});

await test("the spawn pad takes the accent surface's color and material, and the floor's without one", () => {
  const surfaces = {
    floor: { color: "#112233", material: "Slate" },
    wall: { color: "#445566" },
    accent: { color: "#d9a441", material: "Neon" },
  };
  const { parts } = layoutMap(mapSpecSchema.parse(threeRoomInput), surfaces);
  const spawn = partNamed(parts, "start-spawn");
  assert.equal(spawn.role, "accent");
  assert.equal(spawn.color, "#d9a441");
  assert.equal(spawn.material, "Neon");
  assert.equal(partNamed(parts, "start-floor").color, "#112233");
  const withoutAccent = { floor: surfaces.floor, wall: surfaces.wall };
  const plain = partNamed(
    layoutMap(mapSpecSchema.parse(threeRoomInput), withoutAccent).parts,
    "start-spawn",
  );
  assert.equal(plain.color, "#112233");
  assert.equal(plain.material, "Slate");
  const colorOnly = { ...surfaces, accent: { color: "#d9a441" } };
  const colorOnlySpawn = partNamed(
    layoutMap(mapSpecSchema.parse(threeRoomInput), colorOnly).parts,
    "start-spawn",
  );
  assert.equal(colorOnlySpawn.material, "Slate");
});

await test("a layout without the ceilings option has no ceiling part", () => {
  const { parts } = layoutOf(threeRoomInput);
  assert.equal(parts.filter((part) => part.kind === "ceiling").length, 0);
});

await test("ceilings add one slab per room on top of the walls, with shipped defaults", () => {
  const spec = mapSpecSchema.parse({ ...threeRoomInput, wallHeight: 10, wallThickness: 2 });
  const { parts } = layoutMap(spec, undefined, { ceilings: true });
  const ceilings = parts.filter((part) => part.kind === "ceiling");
  assert.deepEqual(
    ceilings.map((part) => part.name),
    ["start", "hall", "vault"].map((room) => `${room}${config.ceilingNameSuffix}`),
  );
  const ceiling = partNamed(parts, "hall-ceiling");
  assert.equal(ceiling.room, "hall");
  assert.equal(ceiling.role, "ceiling");
  assert.equal(ceiling.material, config.defaultCeilingMaterial);
  assert.deepEqual(ceiling.position, { x: 40, y: 11, z: 0 });
  assert.deepEqual(ceiling.size, { x: 40, y: 2, z: 40 });
  const wall = partNamed(parts, "hall-wall-north-1");
  assert.equal(ceiling.position.y - ceiling.size.y / 2, wall.position.y + wall.size.y / 2);
  assert.equal(new Set(parts.map((part) => part.name)).size, parts.length);
});

await test("ceilings take the style's ceiling color and material", () => {
  const surfaces = {
    floor: { color: "#112233" },
    wall: { color: "#445566" },
    ceiling: { color: "#778899", material: "Metal" },
  };
  const { parts } = layoutMap(mapSpecSchema.parse(threeRoomInput), surfaces, { ceilings: true });
  assert.equal(partNamed(parts, "vault-ceiling").color, "#778899");
  assert.equal(partNamed(parts, "vault-ceiling").material, "Metal");
});

await test("the ceiling tag is a non-empty config name", () => {
  assert.ok(config.ceilingTag.length > 0);
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

/** The world position along the wall of each door, per room, per side. */
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

await test("a room graph solves to touching rooms with matching doors", () => {
  const spec = graphSpec(
    ["a", "b", "c"],
    [
      ["a", "b"],
      ["b", "c"],
    ],
  );
  const solved = solveRoomGraph(spec);
  assert.equal(solved.rooms.length, 3);
  assertSolved(spec, solved);
  assert.equal("graph" in solved, false);
});

await test("a graph with a loop solves with every edge a door", () => {
  const edges: [string, string][] = [
    ["a", "b"],
    ["b", "c"],
    ["c", "d"],
    ["d", "a"],
  ];
  const spec = graphSpec(["a", "b", "c", "d"], edges);
  assertSolved(spec, solveRoomGraph(spec));
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

await test("layoutMap builds a graph spec's parts with doors cut in the walls", () => {
  const spec = graphSpec(["a", "b"], [["a", "b"]]);
  const { parts } = layoutMap(spec);
  const walls = parts.filter((part) => part.kind === "wall" && part.room === "a");
  assert.ok(walls.length >= 5, "the wall with the door is split in two");
  assert.deepEqual(layoutMap(solveRoomGraph(spec)), layoutMap(spec));
});

await test("a graph no layout fits is rejected", () => {
  const names = ["hub", "n", "e", "s", "w", "extra"];
  const edges = names.slice(1).map((name): [string, string] => ["hub", name]);
  assert.throws(() => solveRoomGraph(graphSpec(names, edges)), /No layout fits/);
});

await test("a disconnected graph is rejected", () => {
  assert.throws(
    () => solveRoomGraph(graphSpec(["a", "b", "c"], [["a", "b"]])),
    /not connected.*"c"/,
  );
});

await test("joined rooms need the same door width, and a door must fit the shared wall", () => {
  const widths = graphMapSpecSchema.parse({
    mapId: "graph",
    rooms: [graphRoom("a", { doorWidth: 8 }), graphRoom("b")],
    graph: { edges: [{ a: "a", b: "b" }] },
  });
  assert.throws(() => solveRoomGraph(widths), /same doorWidth/);
  const wide = graphMapSpecSchema.parse({
    mapId: "graph",
    rooms: [graphRoom("a", { doorWidth: 40 }), graphRoom("b", { doorWidth: 40 })],
    graph: { edges: [{ a: "a", b: "b" }] },
  });
  assert.throws(() => solveRoomGraph(wide), /No layout fits/);
});
