import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFacades, facadeDimensions, windowCenters } from "./facade-grammar.ts";
import { layoutMap } from "./map-layout.ts";
import { mapSpecSchema } from "./map-spec.ts";

const surfaces = {
  floor: { color: "#111111" },
  wall: { color: "#222222" },
  trim: { color: "#333333", material: "Wood" },
  accent: { color: "#444444", material: "Brick" },
};

function specWith(room: Record<string, unknown>) {
  return mapSpecSchema.parse({
    mapId: "facade",
    wallHeight: 12,
    rooms: [{ name: "shop", x: 0, z: 0, width: 24, depth: 20, ...room }],
  });
}

function facadesOf(room: Record<string, unknown>) {
  const spec = specWith(room);
  const layout = layoutMap(spec, surfaces);
  return { layout, facades: buildFacades(spec, layout.parts, surfaces) };
}

await test("a room not marked exterior gets no facade", () => {
  assert.deepEqual(facadesOf({}).facades, []);
});

await test("windows fill whole bays centered on a stretch", () => {
  assert.deepEqual(windowCenters(20, 6), [-6, 0, 6]);
  assert.deepEqual(windowCenters(4, 6), []);
});

await test("an exterior room gets a cornice, a band per storey boundary and a window per bay and storey", () => {
  const { layout, facades } = facadesOf({ exterior: true, facadeFloors: 3 });
  const walls = layout.parts.filter((part) => part.kind === "wall");
  assert.equal(walls.length, 4);
  const count = (what: string) => facades.filter((part) => part.name.includes(`-${what}-`)).length;
  assert.equal(count("cornice"), 4);
  assert.equal(count("band"), 4 * 2);
  const bays = walls.reduce(
    (sum, wall) =>
      sum +
      windowCenters(Math.max(wall.size.x, wall.size.z), facadeDimensions.bayWidthStuds).length,
    0,
  );
  assert.equal(count("pane"), bays * 3);
  assert.equal(count("frame"), bays * 3);
  assert.equal(new Set(facades.map((part) => part.name)).size, facades.length);
});

await test("storeys stack evenly: pane heights differ per floor and stay under the cornice", () => {
  const { facades } = facadesOf({ exterior: true, facadeFloors: 2 });
  const heights = new Set(
    facades.filter((part) => part.name.includes("-pane-")).map((part) => part.position.y),
  );
  assert.equal(heights.size, 2);
  const cornice = facades.find((part) => part.name.includes("-cornice-"));
  assert.ok(cornice !== undefined && Math.max(...heights) < cornice.position.y);
});

await test("every facade part stands outside the room footprint and never collides", () => {
  const { facades } = facadesOf({ exterior: true });
  assert.ok(facades.length > 0);
  for (const part of facades) {
    const outsideX = Math.abs(part.position.x) - part.size.x / 2 >= 12 - 1e-9;
    const outsideZ = Math.abs(part.position.z) - part.size.z / 2 >= 10 - 1e-9;
    assert.ok(outsideX || outsideZ, `${part.name} sits inside the footprint`);
    assert.equal(part.canCollide, false);
    assert.equal(part.canQuery, false);
  }
});

await test("a door gap stays clear of windows", () => {
  const { facades } = facadesOf({
    exterior: true,
    doors: [{ side: "north", offset: 0 }],
  });
  const door = { min: -3, max: 3 };
  for (const part of facades.filter((entry) => entry.name.includes("-north-"))) {
    const overlaps =
      part.position.x - part.size.x / 2 < door.max && part.position.x + part.size.x / 2 > door.min;
    assert.equal(overlaps, false, `${part.name} covers the doorway`);
  }
});

await test("the same inputs give the same parts", () => {
  assert.deepEqual(facadesOf({ exterior: true }).facades, facadesOf({ exterior: true }).facades);
});
