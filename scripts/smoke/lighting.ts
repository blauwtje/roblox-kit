import { z } from "zod";
import { config } from "../../src/config.ts";
import { buildMapTool } from "../../src/map/build-map-tool.ts";
import { selectStudio, type StudioConnection } from "../../src/studio/studio-connection.ts";
import { recordedSmokeSpec, smokeLightPlacements, smokeMapSpec } from "./build.ts";
import { callRealTool, executeLuau, expectClose, expectEqual, presets } from "./shared.ts";

/** Puts Lighting back from the snapshot the map Model holds; it must run before the Model is destroyed. */
export const restoreLightingLuau = `
local Lighting = game:GetService("Lighting")
local mapsFolder = workspace:FindFirstChild("${config.mapsFolderName}")
local mapModel = if mapsFolder then mapsFolder:FindFirstChild("${smokeMapSpec.mapId}") else nil
local encoded = if mapModel then mapModel:GetAttribute("RobloxKitLightingSnapshot") else nil
if typeof(encoded) == "string" then
  local snapshot = game:GetService("HttpService"):JSONDecode(encoded)
  for name, value in snapshot.lighting do
    if name == "LightingStyle" then Lighting.LightingStyle = Enum.LightingStyle[value]
    elseif name == "Ambient" or name == "OutdoorAmbient" then Lighting[name] = Color3.fromHex(value)
    else Lighting[name] = value end
  end
  local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere")
  if atmosphere and snapshot.atmosphere then
    for name, value in snapshot.atmosphere do
      if name == "Color" or name == "Decay" then atmosphere[name] = Color3.fromHex(value) else atmosphere[name] = value end
    end
  end
  local bloom = Lighting:FindFirstChildOfClass("BloomEffect")
  if bloom and snapshot.bloom then
    for name, value in snapshot.bloom do bloom[name] = value end
  end
  for className, values in snapshot.postProcessing or {} do
    local effect = Lighting:FindFirstChildOfClass(className)
    if effect then
      for name, value in values do
        if typeof(effect[name]) == "Color3" then effect[name] = Color3.fromHex(value) else effect[name] = value end
      end
    end
  end
  for _, className in snapshot.created do
    local effect = Lighting:FindFirstChildOfClass(className)
    if effect then effect:Destroy() end
  end
end`;

/** Reports Lighting as JSON: the recipe's properties and effects, as the smoke compares them. */
export const lightingStateLuau = `
local Lighting = game:GetService("Lighting")
local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere")
local bloom = Lighting:FindFirstChildOfClass("BloomEffect")
local colorCorrection = Lighting:FindFirstChildOfClass("ColorCorrectionEffect")
local sunRays = Lighting:FindFirstChildOfClass("SunRaysEffect")
local depthOfField = Lighting:FindFirstChildOfClass("DepthOfFieldEffect")
local sky = Lighting:FindFirstChildOfClass("Sky")
return game:GetService("HttpService"):JSONEncode({
  LightingStyle = Lighting.LightingStyle.Name,
  Ambient = Lighting.Ambient:ToHex(),
  OutdoorAmbient = Lighting.OutdoorAmbient:ToHex(),
  Brightness = Lighting.Brightness,
  ExposureCompensation = Lighting.ExposureCompensation,
  ShadowSoftness = Lighting.ShadowSoftness,
  effectCount = #Lighting:GetChildren(),
  atmosphereDensity = if atmosphere then atmosphere.Density else -1,
  atmosphereColor = if atmosphere then atmosphere.Color:ToHex() else "",
  bloomIntensity = if bloom then bloom.Intensity else -1,
  colorCorrectionSaturation = if colorCorrection then colorCorrection.Saturation else -9,
  colorCorrectionTint = if colorCorrection then colorCorrection.TintColor:ToHex() else "",
  sunRaysIntensity = if sunRays then sunRays.Intensity else -1,
  depthOfFieldFocusDistance = if depthOfField then depthOfField.FocusDistance else -1,
  skyStarCount = if sky then sky.StarCount else -1,
  skyCelestialBodiesShown = if sky then sky.CelestialBodiesShown else false,
})`;

export const lightingStateSchema = z.object({
  LightingStyle: z.string(),
  Ambient: z.string(),
  OutdoorAmbient: z.string(),
  Brightness: z.number(),
  ExposureCompensation: z.number(),
  ShadowSoftness: z.number(),
  effectCount: z.number(),
  atmosphereDensity: z.number(),
  atmosphereColor: z.string(),
  bloomIntensity: z.number(),
  colorCorrectionSaturation: z.number(),
  colorCorrectionTint: z.string(),
  sunRaysIntensity: z.number(),
  depthOfFieldFocusDistance: z.number(),
  skyStarCount: z.number(),
  skyCelestialBodiesShown: z.boolean(),
});

/** The lights the built map holds (not those inside generated props): each PointLight with its Attachment, the part above it and its world position. */
export const mapLightsLuau = `
local model = workspace:WaitForChild("${config.mapsFolderName}"):WaitForChild("${smokeMapSpec.mapId}")
local lights = {}
for _, descendant in model:GetDescendants() do
  if descendant:IsA("PointLight") and not descendant:FindFirstAncestorOfClass("ProceduralModel") then
    local attachment = descendant.Parent :: Attachment
    local position = attachment.WorldPosition
    local holder = attachment.Parent :: BasePart
    table.insert(lights, {
      part = holder.Name, holderNeon = holder.Material == Enum.Material.Neon, holderCeilingTagged = holder:HasTag("${config.ceilingTag}"),
      holderCanCollide = holder.CanCollide, holderSize = { x = holder.Size.X, y = holder.Size.Y, z = holder.Size.Z }, range = descendant.Range, brightness = descendant.Brightness,
      color = descendant.Color:ToHex(), shadows = descendant.Shadows, x = position.X, y = position.Y, z = position.Z,
    })
  end
end
table.sort(lights, function(first, second)
  if first.x ~= second.x then return first.x < second.x end
  if first.y ~= second.y then return first.y < second.y end
  return first.z < second.z
end)
local snapshot = model:GetAttribute("RobloxKitLightingSnapshot")
return game:GetService("HttpService"):JSONEncode({ lights = lights, snapshot = if typeof(snapshot) == "string" then snapshot else "" })`;

export const mapLightsSchema = z.object({
  lights: z.array(
    z.object({
      part: z.string(),
      holderNeon: z.boolean(),
      holderCeilingTagged: z.boolean(),
      holderCanCollide: z.boolean(),
      holderSize: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      range: z.number(),
      brightness: z.number(),
      color: z.string(),
      shadows: z.boolean(),
      x: z.number(),
      y: z.number(),
      z: z.number(),
    }),
  ),
  snapshot: z.string(),
});

export async function readMapLights(connection: StudioConnection, studioId: string) {
  return mapLightsSchema.parse(JSON.parse(await executeLuau(connection, studioId, mapLightsLuau)));
}

/** Proves the style's lights hang under their rooms' floors, the recipe reached Lighting and a rebuild keeps the snapshot. */
export async function probeLighting(connection: StudioConnection): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  const preset = presets.get("train-station");
  if (preset === undefined) {
    throw new Error("The train-station preset is missing.");
  }
  const hex = (color: string) => color.slice(1).toLowerCase();
  const built = await readMapLights(connection, studioId);
  const placements = smokeLightPlacements().sort(
    (first, second) =>
      first.position.x - second.position.x ||
      first.position.y - second.position.y ||
      first.position.z - second.position.z,
  );
  expectEqual("light count", built.lights.length, placements.length);
  placements.forEach((placement, index) => {
    const light = built.lights[index];
    const roleValues = preset.lightRoles[placement.role];
    if (light === undefined) {
      throw new Error(`No built light for the ${placement.role} placement.`);
    }
    if (placement.fixture === undefined) {
      expectEqual(`${placement.role} light floor part`, light.part, `${placement.zone}-floor`);
    } else {
      expectEqual(
        `${placement.zone} fixture holds its light`,
        light.part.startsWith(`${placement.zone}-${placement.role}-fixture-`),
        true,
      );
      expectEqual(
        `${placement.zone} fixture is Neon and not collidable`,
        light.holderNeon && !light.holderCanCollide,
        true,
      );
      expectEqual(
        `${placement.zone} sconce is not hidden with the ceilings`,
        light.holderCeilingTagged,
        preset.lightFixtures?.kind === "pendant",
      );
      expectClose(`${placement.zone} fixture width`, light.holderSize.x, placement.fixture.size.x);
      expectClose(`${placement.zone} fixture height`, light.holderSize.y, placement.fixture.size.y);
      expectClose(`${placement.zone} fixture depth`, light.holderSize.z, placement.fixture.size.z);
    }
    expectEqual(`${placement.role} light shadows`, light.shadows, placement.shadows);
    expectEqual(`${placement.role} light color`, light.color.toLowerCase(), hex(roleValues.color));
    expectClose(`${placement.role} light range`, light.range, placement.range);
    expectClose(`${placement.role} light brightness`, light.brightness, roleValues.brightness);
    expectClose(`${placement.role} light x`, light.x, placement.position.x);
    expectClose(`${placement.role} light y`, light.y, placement.position.y);
    expectClose(`${placement.role} light z`, light.z, placement.position.z);
  });
  expectEqual("snapshot stored on the map Model", built.snapshot.length > 0, true);

  const recipe = preset.lighting;
  const lighting = lightingStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, lightingStateLuau)),
  );
  expectEqual("Lighting LightingStyle", lighting.LightingStyle, recipe.LightingStyle);
  expectEqual("Lighting Ambient", lighting.Ambient.toLowerCase(), hex(recipe.Ambient));
  expectEqual(
    "Lighting OutdoorAmbient",
    lighting.OutdoorAmbient.toLowerCase(),
    hex(recipe.OutdoorAmbient),
  );
  expectClose("Lighting Brightness", lighting.Brightness, recipe.Brightness);
  expectClose(
    "Lighting ExposureCompensation",
    lighting.ExposureCompensation,
    recipe.ExposureCompensation,
  );
  expectClose("Atmosphere Density", lighting.atmosphereDensity, recipe.Atmosphere.Density);
  expectEqual(
    "Atmosphere Color",
    lighting.atmosphereColor.toLowerCase(),
    hex(recipe.Atmosphere.Color),
  );
  expectClose("Bloom Intensity", lighting.bloomIntensity, recipe.Bloom.Intensity);
  const post = recipe.PostProcessing;
  if (post === undefined) {
    throw new Error("The train-station preset has no PostProcessing block.");
  }
  expectClose(
    "ColorCorrection Saturation",
    lighting.colorCorrectionSaturation,
    post.ColorCorrection.Saturation,
  );
  expectEqual(
    "ColorCorrection TintColor",
    lighting.colorCorrectionTint.toLowerCase(),
    hex(post.ColorCorrection.TintColor),
  );
  expectClose("SunRays Intensity", lighting.sunRaysIntensity, post.SunRays.Intensity);
  expectClose(
    "DepthOfField FocusDistance",
    lighting.depthOfFieldFocusDistance,
    post.DepthOfField.FocusDistance,
  );
  expectClose("Sky StarCount", lighting.skyStarCount, post.Sky.StarCount);
  expectEqual(
    "Sky CelestialBodiesShown",
    lighting.skyCelestialBodiesShown,
    post.Sky.CelestialBodiesShown,
  );

  await callRealTool(buildMapTool, recordedSmokeSpec, connection);
  const rebuilt = await readMapLights(connection, studioId);
  expectEqual("light count after a rebuild", rebuilt.lights.length, placements.length);
  expectEqual("snapshot kept across a rebuild", rebuilt.snapshot, built.snapshot);
  return `${String(placements.length)} lights under their floors, recipe applied, snapshot kept across a rebuild`;
}
