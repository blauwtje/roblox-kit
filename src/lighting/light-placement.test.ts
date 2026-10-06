import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { cornerReachStuds } from "../map/prop-placement.ts";
import { mapSpecSchema } from "../map/map-spec.ts";
import type { Preset } from "../style/preset-schema.ts";
import { placeLights } from "./light-placement.ts";

const lightRoles: Preset["lightRoles"] = {
  zoneMarker: { range: 20, brightness: 1, color: "#ffffff" },
  focal: { range: 30, brightness: 2, color: "#ffeecc" },
  hero: { range: 60, brightness: 3, color: "#ffffff" },
};

function spec(rooms: unknown[], wallHeight?: number) {
  return mapSpecSchema.parse({ mapId: "map", rooms, wallHeight });
}

await test("puts the hero in the largest room and a zone marker in every other room", () => {
  const lights = placeLights(
    spec([
      { name: "hall", x: 0, z: 0, width: 20, depth: 20 },
      { name: "yard", x: 40, z: 0, width: 40, depth: 30 },
      { name: "closet", x: -40, z: 0, width: 10, depth: 10 },
    ]),
    lightRoles,
  );
  assert.deepEqual(lights, [
    {
      zone: "hall",
      role: "zoneMarker",
      position: { x: 0, y: 11, z: 0 },
      range: 20,
      shadows: false,
    },
    { zone: "yard", role: "hero", position: { x: 40, y: 11, z: 0 }, range: 60, shadows: false },
    {
      zone: "closet",
      role: "zoneMarker",
      position: { x: -40, y: 11, z: 0 },
      range: 20,
      shadows: false,
    },
  ]);
});

await test("gives the first room the hero when areas tie", () => {
  const lights = placeLights(
    spec([
      { name: "a", x: 0, z: 0, width: 10, depth: 10 },
      { name: "b", x: 30, z: 0, width: 10, depth: 10 },
    ]),
    lightRoles,
  );
  assert.deepEqual(
    lights.map((light) => light.role),
    ["hero", "zoneMarker"],
  );
});

await test("adds a shadowless focal light over a spawn pad", () => {
  const lights = placeLights(
    spec([
      { name: "big", x: 0, z: 0, width: 40, depth: 40 },
      { name: "start", x: 50, z: 10, width: 10, depth: 10, spawn: true },
    ]),
    lightRoles,
  );
  assert.deepEqual(lights.at(-1), {
    zone: "start",
    role: "focal",
    position: { x: 50, y: 6, z: 10 },
    range: 30,
    shadows: false,
  });
});

await test("hangs lights below the ceiling of the room's resolved wall height", () => {
  const lights = placeLights(
    spec(
      [
        { name: "low", x: 0, z: 0, width: 10, depth: 10, wallHeight: 8 },
        { name: "high", x: 30, z: 0, width: 10, depth: 10 },
      ],
      20,
    ),
    lightRoles,
  );
  assert.deepEqual(
    lights.map((light) => light.position.y),
    [7, 19],
  );
});

await test("no light casts shadows", () => {
  const lights = placeLights(
    spec([
      { name: "a", x: 0, z: 0, width: 30, depth: 30, spawn: true },
      { name: "b", x: 40, z: 0, width: 10, depth: 10, spawn: true },
    ]),
    lightRoles,
  );
  for (const light of lights) {
    assert.equal(light.shadows, false);
  }
});

const sconces: NonNullable<Preset["lightFixtures"]> = {
  kind: "sconce",
  spacing: 10,
  height: 8,
  size: { width: 2, height: 3, depth: 1 },
};

const pendants: NonNullable<Preset["lightFixtures"]> = {
  kind: "pendant",
  spacing: 20,
  drop: 4,
  size: { width: 2, height: 1, depth: 2 },
};

await test("with fixtures every room's center light is a hero and each fixture a zone marker", () => {
  const lights = placeLights(
    spec([
      { name: "hall", x: 0, z: 0, width: 40, depth: 40 },
      { name: "yard", x: 60, z: 0, width: 20, depth: 20 },
    ]),
    lightRoles,
    sconces,
  );
  for (const light of lights) {
    const isFixture = light.fixture !== undefined;
    assert.equal(light.role, isFixture ? "zoneMarker" : "hero");
    assert.equal(light.shadows, false);
    if (light.fixture !== undefined) {
      assert.deepEqual(light.position, light.fixture.position);
    }
  }
  assert.deepEqual(
    lights.filter((light) => light.fixture === undefined).map((light) => light.zone),
    ["hall", "yard"],
  );
});

await test("sconces repeat along every wall at the preset spacing and height, flush to the wall", () => {
  const lights = placeLights(
    spec([{ name: "hall", x: 0, z: 0, width: 40, depth: 40 }]),
    lightRoles,
    sconces,
  );
  const north = lights.filter((light) => light.fixture?.position.z === -18.5);
  const inner = north.map((light) => light.position.x).sort((first, second) => first - second);
  assert.ok(inner.length >= 2);
  for (let index = 1; index < inner.length; index += 1) {
    assert.equal((inner[index] ?? 0) - (inner[index - 1] ?? 0), 10);
  }
  for (const light of lights.filter((entry) => entry.fixture !== undefined)) {
    assert.equal(light.position.y, 8);
  }
  assert.deepEqual(north[0]?.fixture?.size, { x: 2, y: 3, z: 1 });
});

await test("sconces on an east wall swap their width and depth", () => {
  const lights = placeLights(
    spec([{ name: "hall", x: 0, z: 0, width: 40, depth: 40 }]),
    lightRoles,
    { ...sconces, spacing: 40 },
  );
  const east = lights.find((light) => light.fixture?.position.x === 18.5);
  assert.deepEqual(east?.fixture?.size, { x: 1, y: 3, z: 2 });
});

await test("sconces keep out of the corners and of door gaps", () => {
  const room = { name: "hall", x: 0, z: 0, width: 40, depth: 40 };
  const withoutDoor = placeLights(spec([room]), lightRoles, sconces);
  const withDoor = placeLights(
    spec([{ ...room, doors: [{ side: "north", offset: 5 }] }]),
    lightRoles,
    sconces,
  );
  const northOf = (lights: typeof withDoor) =>
    lights.filter((light) => light.fixture?.position.z === -18.5);
  assert.equal(northOf(withDoor).length, northOf(withoutDoor).length - 1);
  for (const light of northOf(withDoor)) {
    assert.ok(Math.abs(light.position.x - 5) >= config.defaultDoorWidthStuds / 2 + 1);
  }
  for (const light of withoutDoor.filter((entry) => entry.fixture !== undefined)) {
    const alongWall = Math.min(Math.abs(light.position.x), Math.abs(light.position.z));
    assert.ok(alongWall <= 19 - cornerReachStuds);
  }
});

await test("pendants hang in a centered grid the drop below the ceiling", () => {
  const lights = placeLights(
    spec([{ name: "hall", x: 10, z: 0, width: 30, depth: 30 }]),
    lightRoles,
    pendants,
  );
  const fixtures = lights.filter((light) => light.fixture !== undefined);
  assert.ok(fixtures.length > 1);
  for (const light of fixtures) {
    assert.equal(light.position.y, config.defaultWallHeightStuds - 4);
    assert.deepEqual(light.fixture?.size, { x: 2, y: 1, z: 2 });
  }
  const xs = fixtures.map((light) => light.position.x - 10);
  assert.equal(Math.min(...xs), -Math.max(...xs));
});

/** Three 20-stud rooms in a row, joined by doors, the first holding the spawn pad. */
const corridor = spec([
  {
    name: "entry",
    x: 0,
    z: 0,
    width: 20,
    depth: 20,
    spawn: true,
    doors: [{ side: "east", offset: 0 }],
  },
  {
    name: "middle",
    x: 20,
    z: 0,
    width: 20,
    depth: 20,
    doors: [
      { side: "west", offset: 0 },
      { side: "east", offset: 0 },
    ],
  },
  { name: "deep", x: 40, z: 0, width: 20, depth: 20, doors: [{ side: "west", offset: 0 }] },
]);

await test("light range shrinks with a room's door distance from the spawn room", () => {
  const ranges = new Map<string, number>();
  for (const light of placeLights(corridor, lightRoles)) {
    if (light.role !== "focal") {
      ranges.set(light.zone, light.range);
    }
  }
  const hero = lightRoles.hero.range;
  const marker = lightRoles.zoneMarker.range;
  // All three rooms are the same size, so the first one is the hero; "deep" is at progression 1 (0.6 of the range).
  assert.equal(ranges.get("entry"), hero);
  assert.ok(Math.abs((ranges.get("middle") ?? 0) - marker * 0.8) < 1e-9);
  assert.ok(Math.abs((ranges.get("deep") ?? 0) - marker * 0.6) < 1e-9);
});

await test("the focal light over the spawn pad keeps its full range", () => {
  const focal = placeLights(corridor, lightRoles).find((light) => light.role === "focal");
  assert.equal(focal?.range, lightRoles.focal.range);
});

await test("caps the lights of a room at maxLocalLightsPerRoom, dropping the latest placed", () => {
  const rooms = [
    { name: "hall", x: 0, z: 0, width: 80, depth: 80, spawn: true },
    { name: "yard", x: 200, z: 0, width: 20, depth: 20 },
  ];
  const lights = placeLights(spec(rooms), lightRoles, sconces);
  const hallLights = lights.filter((light) => light.zone === "hall");
  assert.equal(hallLights.length, config.maxLocalLightsPerRoom);
  assert.equal(hallLights[0]?.role, "hero");
  assert.ok(hallLights.every((light) => light.role !== "focal"));
  assert.ok(lights.filter((light) => light.zone === "yard").length <= config.maxLocalLightsPerRoom);
  assert.deepEqual(
    hallLights.slice(1).map((light) => light.role),
    Array(config.maxLocalLightsPerRoom - 1).fill("zoneMarker"),
  );
});
