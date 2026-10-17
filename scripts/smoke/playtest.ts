import { config } from "../../src/config.ts";
import { buildMapTool } from "../../src/map/build-map-tool.ts";
import { removeMapTool } from "../../src/map/remove-map-tool.ts";
import { createRunPlaytestTool } from "../../src/playtest/run-playtest-tool.ts";
import { type StudioConnection } from "../../src/studio/studio-connection.ts";
import { idleSmokeSpec, smokeMapSpec } from "./build.ts";
import { callRealTool } from "./shared.ts";

export const playServerChecks = `
local maps = workspace:FindFirstChild("${config.mapsFolderName}")
check("map model present", maps ~= nil and maps:FindFirstChild("${smokeMapSpec.mapId}") ~= nil, "Workspace.${config.mapsFolderName}")
check("clients expected", expectedClients == 1, "expectedClients " .. tostring(expectedClients))
local args = game:GetService("StudioTestService"):GetTestArgs()
check("GetTestArgs is a table", typeof(args) == "table", typeof(args))`;

export const playClientChecks = `
check("player named", player.Name ~= "", player.Name)
check("map replicated", workspace:WaitForChild("${config.mapsFolderName}", 10) ~= nil, "client sees the maps folder")`;

export async function probePlaytest(
  connection: StudioConnection,
  input: Parameters<ReturnType<typeof createRunPlaytestTool>["handler"]>[0],
  expectedPeers: number,
): Promise<string> {
  const { output } = await callRealTool(createRunPlaytestTool(), input, connection);
  if (!output.passed || output.peers.length !== expectedPeers) {
    throw new Error(
      `playtest did not pass with ${String(expectedPeers)} peers: ${JSON.stringify(output)}`,
    );
  }
  return `passed, ${String(output.checks.total)} checks over ${String(output.peers.length)} peers in ${String(output.durationMs)} ms`;
}

/** Server checks for the idle smoke map: the Script is there, and each animated sign and lamp moved within a second. */
export const idleServerChecks = `
local maps = workspace:WaitForChild("${config.mapsFolderName}", 10)
local map = maps and maps:FindFirstChild("${idleSmokeSpec.mapId}")
check("idle map present", map ~= nil, "Workspace.${config.mapsFolderName}.${idleSmokeSpec.mapId}")
if not map then return end
check("idle Script present", map:FindFirstChild("RobloxKitIdleAnimation") ~= nil, "RobloxKitIdleAnimation")
local animated = {}
for _, descendant in map:GetDescendants() do
  if descendant:IsA("Model") and descendant:GetAttribute("IdleSwayDegrees") ~= nil then
    table.insert(animated, descendant)
  end
end
local kinds = {}
for _, model in animated do
  local heroKind = model:GetAttribute("RobloxKitHeroKind")
  kinds[if typeof(heroKind) == "string" then heroKind else string.match(model.Name, "^(.-)%-%d+$") or model.Name] = true
end
check("an animated sign", kinds["sign"] == true, "sign")
check("an animated lamp", kinds["lamp"] == true, "lamp")
local before = {}
for index, model in animated do before[index] = model:GetPivot() end
task.wait(1)
local moved = 0
for index, model in animated do
  local delta = before[index]:ToObjectSpace(model:GetPivot())
  local _, angle = delta:ToAxisAngle()
  if delta.Position.Magnitude > 1e-4 or math.abs(angle) > 1e-5 then moved += 1 end
end
check("every animated prop moved within a second", #animated > 0 and moved == #animated, tostring(moved) .. " of " .. tostring(#animated))`;

/** Builds the idle smoke map, checks in a run playtest that its signs and lamps sway, then removes it. */
export async function probeIdleAnimation(connection: StudioConnection): Promise<string> {
  await callRealTool(buildMapTool, idleSmokeSpec, connection);
  try {
    return await probePlaytest(
      connection,
      { mode: "run", serverChecks: idleServerChecks, timeoutSeconds: 30 },
      1,
    );
  } finally {
    await callRealTool(removeMapTool, { mapId: idleSmokeSpec.mapId }, connection);
  }
}
