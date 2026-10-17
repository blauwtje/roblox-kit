import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSpecSchema } from "../map/map-spec.ts";
import type { PropRecord } from "../map/prop-placement.ts";
import type { Preset } from "../style/preset-schema.ts";
import { npcConfig } from "./npc-config.ts";
import { planNpcs } from "./plan-npcs.ts";
import { bakeRouteGraph } from "./route-graph.ts";

function specWith(npcs: object | undefined) {
  return mapSpecSchema.parse({
    mapId: "m",
    wallThickness: 1,
    npcs,
    rooms: [{ name: "hall", x: 0, z: 0, width: 40, depth: 40, roomType: "hall" }],
  });
}

function presetWith(behaviors: Record<string, number>, density = 4): Preset {
  const outfit = { head: "#ffffff", torso: "#ffffff", arms: "#ffffff", legs: "#ffffff" };
  return {
    npcRoles: {
      rider: {
        outfits: [
          { ...outfit, scale: { min: 1, max: 1 } },
          { ...outfit, scale: { min: 1, max: 1 } },
        ],
        speed: { min: 1, max: 2 },
        chatLines: ["hi"],
        behaviors,
      },
    },
    roomTypes: { hall: { npcs: [{ role: "rider", density }] } },
  } as unknown as Preset;
}

const bench: PropRecord = {
  kind: "bench",
  pivot: { x: 5, y: 1.5, z: 5 },
  size: { x: 6, y: 3, z: 2.5 },
  seed: 1,
};

function plan(npcs: object | undefined, behaviors: Record<string, number>, props = [bench]) {
  const spec = specWith(npcs);
  return planNpcs({
    spec,
    preset: presetWith(behaviors),
    props,
    graph: bakeRouteGraph(spec, props),
  });
}

await test("no npcs switch gives an empty roster", () => {
  assert.deepEqual(plan(undefined, { idle: 1 }), []);
});

await test("the same seed gives the same roster and a different seed another", () => {
  const first = plan({ density: 1, seed: 3 }, { idle: 1, walk: 1, sit: 1 });
  assert.deepEqual(plan({ density: 1, seed: 3 }, { idle: 1, walk: 1, sit: 1 }), first);
  assert.notDeepEqual(plan({ density: 1, seed: 4 }, { idle: 1, walk: 1, sit: 1 }), first);
});

await test("caps hold per room and by maxTotal", () => {
  const crowded = presetWith({ idle: 1 }, 20);
  const spec = specWith({ density: 1 });
  const roster = planNpcs({ spec, preset: crowded, props: [], graph: bakeRouteGraph(spec, []) });
  assert.equal(roster.length, npcConfig.maxNpcsPerRoom);
  assert.equal(plan({ density: 1, maxTotal: 2 }, { idle: 1 }).length, 2);
});

await test("sitters take distinct bench seats; without a bench they stand idle", () => {
  const everyone = plan({ density: 1 }, { sit: 1 });
  const seated = everyone.filter((npc) => npc.behavior === "sit");
  assert.equal(seated.length, 3);
  assert.ok(everyone.every((npc) => npc.behavior === "sit" || npc.seatId === undefined));
  const seatIds = seated.map((npc) => npc.seatId);
  assert.equal(new Set(seatIds).size, seatIds.length);
  assert.ok(seated.every((npc) => npc.position.y > 1));
  const none = plan({ density: 1 }, { sit: 1 }, []);
  assert.ok(none.length > 0 && none.every((npc) => npc.behavior === "idle" && !npc.seatId));
});

await test("walkers carry a route of at least two points starting at their position", () => {
  const walkers = plan({ density: 1 }, { walk: 1 }).filter((npc) => npc.behavior === "walk");
  assert.ok(walkers.length > 0);
  for (const npc of walkers) {
    assert.ok((npc.route?.length ?? 0) >= 2);
    assert.deepEqual([npc.route?.[0]?.x, npc.route?.[0]?.z], [npc.position.x, npc.position.z]);
  }
});
