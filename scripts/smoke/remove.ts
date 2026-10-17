import { z } from "zod";
import { config } from "../../src/config.ts";
import { buildMapTool } from "../../src/map/build-map-tool.ts";
import { removeMapTool } from "../../src/map/remove-map-tool.ts";
import { selectStudio, type StudioConnection } from "../../src/studio/studio-connection.ts";
import { lightingStateLuau, lightingStateSchema, restoreLightingLuau } from "./lighting.ts";
import {
  ambientSmokeSpec,
  blockerModelName,
  facadeSmokeSpec,
  idleSmokeSpec,
  secondSmokeSpec,
  smokeMapSpec,
  smokeRegion,
  terrainSmokeSpec,
} from "./build.ts";
import { callRealTool, executeLuau, expectEqual } from "./shared.ts";

/** Removes what the smoke and the tools insert: only names and the region the smoke owns; other maps stay. */
export const cleanupLuau = `${restoreLightingLuau}
local ServerScriptService = game:GetService("ServerScriptService")
local StarterPlayerScripts = game:GetService("StarterPlayer"):FindFirstChildOfClass("StarterPlayerScripts")
local function destroyNamed(container, name)
  if container == nil then return end
  for _, child in container:GetChildren() do
    if child.Name == name then child:Destroy() end
  end
end
local mapsFolder = workspace:FindFirstChild("${config.mapsFolderName}")
destroyNamed(mapsFolder, "${smokeMapSpec.mapId}")
destroyNamed(mapsFolder, "${blockerModelName}")
destroyNamed(mapsFolder, "${secondSmokeSpec.mapId}")
destroyNamed(mapsFolder, "${facadeSmokeSpec.mapId}")
destroyNamed(mapsFolder, "${ambientSmokeSpec.mapId}")
destroyNamed(mapsFolder, "${idleSmokeSpec.mapId}")
destroyNamed(mapsFolder, "${terrainSmokeSpec.mapId}")
if mapsFolder and #mapsFolder:GetChildren() == 0 then mapsFolder:Destroy() end
for _, variant in game:GetService("MaterialService"):GetChildren() do
  if variant:IsA("MaterialVariant") and string.sub(variant.Name, 1, ${String(smokeMapSpec.mapId.length + 1)}) == "${smokeMapSpec.mapId}-" then variant:Destroy() end
end
destroyNamed(ServerScriptService, "RobloxKitPlaytestServerHarness")
destroyNamed(StarterPlayerScripts, "RobloxKitPlaytestClientHarness")
local min = Vector3.new(${smokeRegion.min.join(", ")})
local max = Vector3.new(${smokeRegion.max.join(", ")})
workspace.Terrain:FillBlock(CFrame.new((min + max) / 2), max - min, Enum.Material.Air)
return "cleaned"`;

/** Reports the place state as one line; the smoke fails unless it is the state the place started in. */
export const placeStateLuau = `
local names = {}
for _, child in workspace:GetChildren() do table.insert(names, child.Name) end
table.sort(names)
local storage = game:GetService("ServerStorage"):GetChildren()
local min = Vector3.new(${smokeRegion.min.join(", ")})
local max = Vector3.new(${smokeRegion.max.join(", ")})
local voxels = workspace.Terrain:ReadVoxels(Region3.new(min, max):ExpandToGrid(4), 4)
local solid = 0
for x = 1, voxels.Size.X do
  for y = 1, voxels.Size.Y do
    for z = 1, voxels.Size.Z do
      if voxels[x][y][z] ~= Enum.Material.Air then solid += 1 end
    end
  end
end
local smokeVariants = 0
for _, variant in game:GetService("MaterialService"):GetChildren() do
  if string.sub(variant.Name, 1, ${String(smokeMapSpec.mapId.length + 1)}) == "${smokeMapSpec.mapId}-" then smokeVariants += 1 end
end
local harnesses = 0
for _, name in { "RobloxKitPlaytestServerHarness", "RobloxKitPlaytestClientHarness" } do
  if game:GetService("ServerScriptService"):FindFirstChild(name) then harnesses += 1 end
  local scripts = game:GetService("StarterPlayer"):FindFirstChildOfClass("StarterPlayerScripts")
  if scripts and scripts:FindFirstChild(name) then harnesses += 1 end
end
return game:GetService("HttpService"):JSONEncode({
  workspace = names, smokeVariants = smokeVariants, serverStorage = #storage, solidTerrainVoxels = solid, harnesses = harnesses,
})`;

export const placeStateSchema = z.object({
  workspace: z.array(z.string()),
  serverStorage: z.number(),
  solidTerrainVoxels: z.number(),
  smokeVariants: z.number(),
  harnesses: z.number(),
});

/** Proves the lighting rule: build A (already built), build B, remove A, remove B ends on the original lighting. */
export async function probeRemoveMapLighting(
  connection: StudioConnection,
  lightingBefore: z.output<typeof lightingStateSchema>,
  stateBefore: z.output<typeof placeStateSchema>,
): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  const readLighting = async () =>
    lightingStateSchema.parse(
      JSON.parse(await executeLuau(connection, studioId, lightingStateLuau)),
    );
  const styled = await readLighting();
  if (JSON.stringify(styled) === JSON.stringify(lightingBefore)) {
    throw new Error("The styled build left Lighting unchanged, so the rule cannot be told apart.");
  }
  await callRealTool(buildMapTool, secondSmokeSpec, connection);
  const { output: removedFirst } = await callRealTool(
    removeMapTool,
    { mapId: smokeMapSpec.mapId },
    connection,
  );
  expectEqual("remove_map A restored", removedFirst.lighting.restored, null);
  expectEqual("remove_map A remaining styled maps", removedFirst.lighting.remainingStyledMaps, [
    secondSmokeSpec.mapId,
  ]);
  expectEqual("remove_map A warnings", removedFirst.warnings.length, 1);
  expectEqual("Lighting after removing A", await readLighting(), styled);
  const { output: removedSecond } = await callRealTool(
    removeMapTool,
    { mapId: secondSmokeSpec.mapId },
    connection,
  );
  expectEqual("remove_map B restored", removedSecond.lighting.restored, "original");
  expectEqual("remove_map B remaining styled maps", removedSecond.lighting.remainingStyledMaps, []);
  expectEqual("Lighting after removing B", await readLighting(), lightingBefore);
  // Read before the cleanup in the caller's `finally`, which would remove these itself.
  const stateAfter = placeStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, placeStateLuau)),
  );
  expectEqual(
    "Workspace children after removing both maps",
    stateAfter.workspace,
    stateBefore.workspace,
  );
  expectEqual("terrain voxels after removing both maps", stateAfter.solidTerrainVoxels, 0);
  expectEqual("smoke MaterialVariants after removing both maps", stateAfter.smokeVariants, 0);
  return "lighting held while B remained and returned to the original after B; folder, terrain and variants gone";
}
