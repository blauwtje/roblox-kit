--!strict
-- Applies a lighting recipe to Lighting and reports whether a snapshot was taken. Before the first
-- write the previous values and the effects it creates are stored as a JSON attribute on the map
-- Model; a later apply restores that snapshot first and never snapshots its own values.
-- The deprecated Technology property is never read or written.
type AtmosphereValues = {
	Density: number,
	Offset: number,
	Color: string,
	Decay: string,
	Glare: number,
	Haze: number,
}

type BloomValues = {
	Intensity: number,
	Size: number,
	Threshold: number,
}

type LightingValues = {
	LightingStyle: string,
	PrioritizeLightingQuality: boolean,
	Ambient: string,
	OutdoorAmbient: string,
	Brightness: number,
	ExposureCompensation: number,
	EnvironmentDiffuseScale: number,
	EnvironmentSpecularScale: number,
	ShadowSoftness: number,
}

type Recipe = LightingValues & {
	Atmosphere: AtmosphereValues,
	Bloom: BloomValues,
}

type Snapshot = {
	lighting: LightingValues,
	-- The values of the Atmosphere and BloomEffect that existed before; nil when the apply created it.
	atmosphere: AtmosphereValues?,
	bloom: BloomValues?,
	-- Class names of the effects the first apply created, destroyed again on restore.
	created: { string },
}

type Arguments = {
	mapId: string,
	mapsFolderName: string,
	recipe: Recipe,
}

-- Attribute on the map Model holding the Lighting snapshot as JSON.
local SNAPSHOT_ATTRIBUTE_NAME = "RobloxKitLightingSnapshot"

local arguments: Arguments = ...
local HttpService = game:GetService("HttpService")
local Lighting = game:GetService("Lighting")

local function findMapModel(): Model
	local folder = workspace:FindFirstChild(arguments.mapsFolderName)
	local model = if folder then folder:FindFirstChild(arguments.mapId) else nil
	if not model or not model:IsA("Model") then
		error(
			`Map "{arguments.mapId}" is not under Workspace.{arguments.mapsFolderName}; build it before applying lighting.`,
			0
		)
	end
	return model
end

local function readLighting(): LightingValues
	return {
		LightingStyle = Lighting.LightingStyle.Name,
		PrioritizeLightingQuality = Lighting.PrioritizeLightingQuality,
		Ambient = Lighting.Ambient:ToHex(),
		OutdoorAmbient = Lighting.OutdoorAmbient:ToHex(),
		Brightness = Lighting.Brightness,
		ExposureCompensation = Lighting.ExposureCompensation,
		EnvironmentDiffuseScale = Lighting.EnvironmentDiffuseScale,
		EnvironmentSpecularScale = Lighting.EnvironmentSpecularScale,
		ShadowSoftness = Lighting.ShadowSoftness,
	}
end

local function writeLighting(values: LightingValues)
	Lighting.LightingStyle = (Enum.LightingStyle:FromName(values.LightingStyle) :: any) :: Enum.LightingStyle
	Lighting.PrioritizeLightingQuality = values.PrioritizeLightingQuality
	Lighting.Ambient = Color3.fromHex(values.Ambient)
	Lighting.OutdoorAmbient = Color3.fromHex(values.OutdoorAmbient)
	Lighting.Brightness = values.Brightness
	Lighting.ExposureCompensation = values.ExposureCompensation
	Lighting.EnvironmentDiffuseScale = values.EnvironmentDiffuseScale
	Lighting.EnvironmentSpecularScale = values.EnvironmentSpecularScale
	Lighting.ShadowSoftness = values.ShadowSoftness
end

local function readAtmosphere(atmosphere: Atmosphere): AtmosphereValues
	return {
		Density = atmosphere.Density,
		Offset = atmosphere.Offset,
		Color = atmosphere.Color:ToHex(),
		Decay = atmosphere.Decay:ToHex(),
		Glare = atmosphere.Glare,
		Haze = atmosphere.Haze,
	}
end

local function writeAtmosphere(atmosphere: Atmosphere, values: AtmosphereValues)
	atmosphere.Density = values.Density
	atmosphere.Offset = values.Offset
	atmosphere.Color = Color3.fromHex(values.Color)
	atmosphere.Decay = Color3.fromHex(values.Decay)
	atmosphere.Glare = values.Glare
	atmosphere.Haze = values.Haze
end

local function readBloom(bloom: BloomEffect): BloomValues
	return { Intensity = bloom.Intensity, Size = bloom.Size, Threshold = bloom.Threshold }
end

local function writeBloom(bloom: BloomEffect, values: BloomValues)
	bloom.Intensity = values.Intensity
	bloom.Size = values.Size
	bloom.Threshold = values.Threshold
end

-- The first existing effect of a class under Lighting is reused; one is created only when absent.
local function firstEffect(className: string): Instance?
	for _, child in Lighting:GetChildren() do
		if child.ClassName == className then
			return child
		end
	end
	return nil
end

local function snapshotNow(): Snapshot
	local atmosphere = firstEffect("Atmosphere")
	local bloom = firstEffect("BloomEffect")
	local created: { string } = {}
	if not atmosphere then
		table.insert(created, "Atmosphere")
	end
	if not bloom then
		table.insert(created, "BloomEffect")
	end
	return {
		lighting = readLighting(),
		atmosphere = if atmosphere then readAtmosphere(atmosphere :: Atmosphere) else nil,
		bloom = if bloom then readBloom(bloom :: BloomEffect) else nil,
		created = created,
	}
end

local function restore(snapshot: Snapshot)
	writeLighting(snapshot.lighting)
	local atmosphere = firstEffect("Atmosphere")
	local atmosphereValues = snapshot.atmosphere
	if atmosphere and atmosphereValues then
		writeAtmosphere(atmosphere :: Atmosphere, atmosphereValues)
	end
	local bloom = firstEffect("BloomEffect")
	local bloomValues = snapshot.bloom
	if bloom and bloomValues then
		writeBloom(bloom :: BloomEffect, bloomValues)
	end
	for _, className in snapshot.created do
		local effect = firstEffect(className)
		if effect then
			effect:Destroy()
		end
	end
end

local function effectOrNew(className: string): Instance
	local existing = firstEffect(className)
	if existing then
		return existing
	end
	local effect = Instance.new(className)
	effect.Parent = Lighting
	return effect
end

local model = findMapModel()
local encoded = model:GetAttribute(SNAPSHOT_ATTRIBUTE_NAME)
local snapshotTaken = typeof(encoded) ~= "string"
if typeof(encoded) == "string" then
	restore(HttpService:JSONDecode(encoded) :: Snapshot)
else
	model:SetAttribute(SNAPSHOT_ATTRIBUTE_NAME, HttpService:JSONEncode(snapshotNow()))
end

local recipe = arguments.recipe
writeLighting(recipe)
writeAtmosphere(effectOrNew("Atmosphere") :: Atmosphere, recipe.Atmosphere)
writeBloom(effectOrNew("BloomEffect") :: BloomEffect, recipe.Bloom)

return HttpService:JSONEncode({ snapshotTaken = snapshotTaken })
