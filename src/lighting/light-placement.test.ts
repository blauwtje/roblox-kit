import assert from "node:assert/strict";
import { test } from "node:test";
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
    { role: "zoneMarker", position: { x: 0, y: 11, z: 0 }, range: 20, shadows: false },
    { role: "hero", position: { x: 40, y: 11, z: 0 }, range: 60, shadows: true },
    { role: "zoneMarker", position: { x: -40, y: 11, z: 0 }, range: 20, shadows: false },
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

await test("only the hero casts shadows", () => {
  const lights = placeLights(
    spec([
      { name: "a", x: 0, z: 0, width: 30, depth: 30, spawn: true },
      { name: "b", x: 40, z: 0, width: 10, depth: 10, spawn: true },
    ]),
    lightRoles,
  );
  for (const light of lights) {
    assert.equal(light.shadows, light.role === "hero");
  }
});
