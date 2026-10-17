import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import type { StudioToolRequest } from "../studio/studio-connection.ts";
import type { Preset } from "../style/preset-schema.ts";
import { buildNpcs } from "./build-npcs.ts";
import type { NpcRecord } from "./plan-npcs.ts";

const outfit = { head: "#111111", torso: "#222222", arms: "#333333", legs: "#444444" };
const preset = {
  npcRoles: {
    rider: {
      outfits: [
        { ...outfit, scale: { min: 1, max: 1 } },
        { ...outfit, torso: "#abcdef", scale: { min: 0.9, max: 1.1 } },
      ],
      speed: { min: 2, max: 4 },
      chatLines: ["hello there"],
      behaviors: { idle: 1 },
    },
  },
} as unknown as Preset;
const roster: NpcRecord[] = [
  {
    id: "npc-1",
    role: "rider",
    outfitIndex: 1,
    behavior: "idle",
    position: { x: 1, y: 0, z: 2 },
    yaw: 90,
    phase: 0.5,
  },
];
const graph = { nodes: [], edges: [] };

function connectionReturning(result: object) {
  return new FakeStudioConnection([{ id: "s", name: "Place" }], {
    execute_luau: () => ({ content: [{ type: "text", text: JSON.stringify(result) }] }),
  });
}

await test("sends the roster with resolved outfits and the client script, and returns the result", async () => {
  const connection = connectionReturning({ built: 1, characterPath: "rig", warnings: ["w"] });
  const result = await buildNpcs({ connection, studioId: "s", mapId: "m", roster, graph, preset });
  assert.deepEqual(result, { built: 1, characterPath: "rig", warnings: ["w"] });
  const request = connection.requests[0] as StudioToolRequest;
  assert.equal(request.arguments["datamodel_type"], "Edit");
  const code = String(request.arguments["code"]);
  assert.match(code, /"torso":"#abcdef"/);
  assert.match(code, /"speed":3/);
  assert.match(code, /"chatLines":\["hello there"\]/);
  assert.match(code, /Heartbeat:Connect/);
});

await test("rejects a role the preset does not declare before calling Studio", async () => {
  const connection = connectionReturning({ built: 0, characterPath: "avatar", warnings: [] });
  const stray = [{ ...(roster[0] as NpcRecord), role: "ghost" }];
  await assert.rejects(
    buildNpcs({ connection, studioId: "s", mapId: "m", roster: stray, graph, preset }),
    /undeclared role "ghost"/,
  );
  assert.equal(connection.requests.length, 0);
});

await test("rejects a result with an unknown character path", async () => {
  const connection = connectionReturning({ built: 1, characterPath: "robot", warnings: [] });
  await assert.rejects(buildNpcs({ connection, studioId: "s", mapId: "m", roster, graph, preset }));
});
