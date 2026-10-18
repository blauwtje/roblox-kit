import { z } from "zod";
import { config } from "../../src/config.ts";
import { buildMapTool } from "../../src/map/build-map-tool.ts";
import { relationMapSpecSchema } from "../../src/map/map-spec.ts";
import { removeMapTool } from "../../src/map/remove-map-tool.ts";
import { npcConfig } from "../../src/npc/npc-config.ts";
import { selectStudio, type StudioConnection } from "../../src/studio/studio-connection.ts";
import { probePlaytest } from "./playtest.ts";
import { callRealTool, executeLuau, expectEqual } from "./shared.ts";

/** A styled platform with people, clutter, signage and motion all switched on; removed by its own step. */
export const npcSmokeSpec = relationMapSpecSchema.parse({
  mapId: "smoke-npcs",
  seed: 11,
  style: { preset: "train-station" },
  npcs: { density: 1, seed: 5 },
  clutter: true,
  signage: true,
  motion: true,
  rooms: [
    {
      name: "concourse",
      roomType: "concourse",
      x: 2700,
      z: 2600,
      width: 60,
      depth: 30,
      doors: [{ side: "south" }],
    },
    {
      name: "platform",
      x: 2700,
      z: 2630,
      width: 60,
      depth: 30,
      roomType: "platform",
      doors: [{ side: "north" }],
    },
  ],
});

const runtimeScriptName = "RobloxKitNpcRuntime";

const npcStateLuau = `
local HttpService = game:GetService("HttpService")
local maps = workspace:FindFirstChild("${config.mapsFolderName}")
local map = maps and maps:FindFirstChild("${npcSmokeSpec.mapId}")
local folder = map and map:FindFirstChild("Npcs")
local models = 0
if folder then
  for _, child in folder:GetChildren() do
    if child:IsA("Model") then models += 1 end
  end
end
local scripts = game:GetService("StarterPlayer"):FindFirstChildOfClass("StarterPlayerScripts")
return HttpService:JSONEncode({
  map = map ~= nil,
  models = models,
  runtime = scripts ~= nil and scripts:FindFirstChild("${runtimeScriptName}") ~= nil,
})`;

const npcStateSchema = z.object({ map: z.boolean(), models: z.number(), runtime: z.boolean() });

const npcServerChecks = `
local maps = workspace:WaitForChild("${config.mapsFolderName}", 10)
local map = maps and maps:FindFirstChild("${npcSmokeSpec.mapId}")
local folder = map and map:FindFirstChild("Npcs")
check("Npcs folder present", folder ~= nil, "Npcs")
local models = 0
if folder then
  for _, child in folder:GetChildren() do
    if child:IsA("Model") then models += 1 end
  end
end
check("npcs within the map cap", models > 0 and models <= ${String(npcConfig.maxNpcsPerMap)}, tostring(models))`;

const npcClientChecks = `
local maps = workspace:WaitForChild("${config.mapsFolderName}", 10)
local map = maps and maps:WaitForChild("${npcSmokeSpec.mapId}", 10)
local folder = map and map:WaitForChild("Npcs", 10)
check("client sees the npcs", folder ~= nil and #folder:GetChildren() > 0, "Npcs")
task.wait(3)
check("npc runtime keeps the npcs after 3 s", folder ~= nil and #folder:GetChildren() > 0, "Npcs")`;

async function readNpcState(connection: StudioConnection, studioId: string) {
  return npcStateSchema.parse(JSON.parse(await executeLuau(connection, studioId, npcStateLuau)));
}

/** Builds the npc smoke map, checks the people in edit mode and in a 30 s play playtest, then checks remove_map takes them away. */
export async function probeBuildMapNpcs(connection: StudioConnection): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  let removed = false;
  try {
    const built = (await callRealTool(buildMapTool, npcSmokeSpec, connection)).output;
    const state = await readNpcState(connection, studioId);
    expectEqual("map built", state.map, true);
    if (state.models < 1 || state.models > npcConfig.maxNpcsPerMap) {
      throw new Error(
        `npc models: expected 1 to ${String(npcConfig.maxNpcsPerMap)}, got ${String(state.models)}`,
      );
    }
    expectEqual("npc runtime script installed", state.runtime, true);
    const playtest = await probePlaytest(
      connection,
      {
        mode: "play",
        serverChecks: npcServerChecks,
        clientChecks: npcClientChecks,
        timeoutSeconds: 30,
      },
      2,
    );
    await callRealTool(removeMapTool, { mapId: npcSmokeSpec.mapId }, connection);
    removed = true;
    const after = await readNpcState(connection, studioId);
    expectEqual("map after remove_map", [after.map, after.models], [false, 0]);
    return `${String(state.models)} npcs, ${String(built.warnings.length)} warnings, playtest ${playtest}; map gone after remove_map (runtime script left in StarterPlayerScripts: ${String(after.runtime)})`;
  } finally {
    if (!removed) {
      await callRealTool(removeMapTool, { mapId: npcSmokeSpec.mapId }, connection);
    }
    await executeLuau(
      connection,
      studioId,
      `local scripts = game:GetService("StarterPlayer"):FindFirstChildOfClass("StarterPlayerScripts")
local runtime = scripts and scripts:FindFirstChild("${runtimeScriptName}")
if runtime then runtime:Destroy() end
return "ok"`,
    );
  }
}
