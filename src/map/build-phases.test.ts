import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPhaseNames, groupBuildPhases } from "./build-phases.ts";
import { layoutMap } from "./map-layout.ts";
import { mapSpecSchema } from "./map-spec.ts";
import { placeProps } from "./prop-placement.ts";
import { buildRoomDetails } from "./room-details.ts";

const surfaces = {
  floor: { color: "#111111" },
  wall: { color: "#222222" },
  ceiling: { color: "#333333" },
  trim: { color: "#444444", material: "Wood" },
  accent: { color: "#555555", material: "Neon" },
};

const spec = mapSpecSchema.parse({
  mapId: "phases",
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
    { name: "hall", x: 40, z: 0, width: 40, depth: 40, doors: [{ side: "west" }] },
  ],
});

const layout = layoutMap(spec, surfaces, { ceilings: true });
const details = buildRoomDetails(spec, layout.parts, surfaces);
const props = placeProps(spec, ["bench", "lamp"], 1);
const lights = [{ zone: "start" }, { zone: "hall" }];
const phases = groupBuildPhases({ parts: layout.parts, details, props, lights });

await test("six phases come in the build order", () => {
  assert.deepEqual(
    phases.map((phase) => phase.name),
    ["shell", "floors and ceilings", "openings", "surfaces", "props", "lighting"],
  );
  assert.deepEqual(
    phases.map((phase) => phase.name),
    [...buildPhaseNames],
  );
});

await test("every part lands in exactly one phase", () => {
  const grouped = phases.flatMap((phase) => phase.parts);
  assert.equal(grouped.length, layout.parts.length + details.length + props.length + lights.length);
  assert.equal(new Set(grouped).size, grouped.length);
});

await test("each phase holds the parts of its kind", () => {
  const byName = Object.fromEntries(phases.map((phase) => [phase.name, phase.parts]));
  const kindsOf = (name: string) =>
    new Set(byName[name]?.map((part) => "kind" in part && part.kind));
  assert.deepEqual(kindsOf("shell"), new Set(["wall"]));
  assert.deepEqual(kindsOf("floors and ceilings"), new Set(["floor", "spawn", "ceiling"]));
  assert.deepEqual(kindsOf("openings"), new Set(["arch"]));
  assert.deepEqual(kindsOf("surfaces"), new Set(["trim", "stripe", "pillar"]));
  assert.deepEqual(byName["props"], props);
  assert.deepEqual(byName["lighting"], lights);
});

await test("a layout without decor keeps all six phases, the empty ones with no parts", () => {
  const bare = layoutMap(spec);
  const barePhases = groupBuildPhases({ parts: bare.parts, details: [], props: [], lights: [] });
  assert.equal(barePhases.length, 6);
  const counts = Object.fromEntries(barePhases.map((phase) => [phase.name, phase.parts.length]));
  assert.equal(counts["openings"], 0);
  assert.equal(counts["surfaces"], 0);
  assert.equal(counts["props"], 0);
  assert.equal(counts["lighting"], 0);
  assert.ok((counts["shell"] ?? 0) > 0);
  assert.ok((counts["floors and ceilings"] ?? 0) > 0);
});
