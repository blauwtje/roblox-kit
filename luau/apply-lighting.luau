--!strict
-- Applies a lighting recipe to Lighting and reports whether a snapshot was taken; without a recipe it
-- only restores the stored snapshot. Before the first
-- write the previous values and the effects it creates are stored as a JSON attribute on the map
-- Model; a later apply restores that snapshot first and never snapshots its own values.
-- The place's original lighting is also saved once, in the same shape, as a JSON attribute on the maps
-- folder when a recipe is first applied with none saved and no other styled map; it is never overwritten.
-- With `removing` nothing is applied: when the map is the last styled map the original (or, for an older
-- place with none saved, the map's own snapshot) is restored and the folder attribute cleared; otherwise
-- Lighting is left as it is. A styled map is a Model holding the snapshot attribute.
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

-- Property values of one post-processing effect; a Color3 is stored as hex.
type EffectValues = { [string]: any }

type Recipe = LightingValues & {
	Atmosphere: AtmosphereValues,
	Bloom: BloomValues,
	-- Keyed by the names in POST_EFFECTS; absent: the post-processing effects are left alone.
	PostProcessing: { [string]: EffectValues }?,
}

type Snapshot = {
	lighting: LightingValues,
	-- The values of the Atmosphere and BloomEffect that existed before; nil when the apply created it.
	atmosphere: AtmosphereValues?,
	bloom: BloomValues?,
	-- The values of the existing post-processing effects by class name; a class the apply created is absent.
	postProcessing: { [string]: EffectValues }?,
	-- Class names of the effects the first apply created, destroyed again on restore.
	created: { string },
}

type Arguments = {
	mapId: string,
	mapsFolderName: string,
	-- Absent: restore the stored snapshot only.
	recipe: Recipe?,
	-- True: restore on removal of the map instead of applying.
	removing: boolean?,
}

-- Attribute on the map Model holding the Lighting snapshot as JSON.
local SNAPSHOT_ATTRIBUTE_NAME = "RobloxKitLightingSnapshot"
-- Attribute on the maps folder holding the place's original Lighting as JSON, in the Snapshot shape.
local ORIGINAL_ATTRIBUTE_NAME = "RobloxKitOriginalLighting"

-- The post-processing effects: the recipe key, the class under Lighting and the properties read and written.
local POST_EFFECTS: { { key: string, className: string, properties: { string } } } = {
	{
		key = "ColorCorrection",
		className = "ColorCorrectionEffect",
		properties = { "Brightness", "Contrast", "Saturation", "TintColor" },
	},
	{ key = "SunRays", className = "SunRaysEffect", properties = { "Intensity", "Spread" } },
	{
		key = "DepthOfField",
		className = "DepthOfFieldEffect",
		properties = { "FarIntensity", "FocusDistance", "InFocusRadius", "NearIntensity" },
	},
	{
		key = "Sky",
		className = "Sky",
		properties = { "StarCount", "CelestialBodiesShown", "SunAngularSize", "MoonAngularSize" },
	},
}

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

local function readEffect(effect: Instance, properties: { string }): EffectValues
	local values: EffectValues = {}
	for _, property in properties do
		local value = (effect :: any)[property]
		values[property] = if typeof(value) == "Color3" then value:ToHex() else value
	end
	return values
end

local function writeEffect(effect: Instance, values: EffectValues)
	for property, value in values do
		if typeof((effect :: any)[property]) == "Color3" then
			(effect :: any)[property] = Color3.fromHex(value)
		else
			(effect :: any)[property] = value
		end
	end
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
	local postProcessing: { [string]: EffectValues } = {}
	for _, post in POST_EFFECTS do
		local effect = firstEffect(post.className)
		if effect then
			postProcessing[post.className] = readEffect(effect, post.properties)
		else
			table.insert(created, post.className)
		end
	end
	return {
		lighting = readLighting(),
		atmosphere = if atmosphere then readAtmosphere(atmosphere :: Atmosphere) else nil,
		bloom = if bloom then readBloom(bloom :: BloomEffect) else nil,
		postProcessing = postProcessing,
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
	local postValues = snapshot.postProcessing
	if postValues then
		for className, values in postValues do
			local effect = firstEffect(className)
			if effect then
				writeEffect(effect, values)
			end
		end
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

local function findMapsFolder(): Instance
	return workspace:FindFirstChild(arguments.mapsFolderName) :: Instance
end

-- Names of the styled maps under the folder other than this one, sorted.
local function otherStyledMaps(): { string }
	local names: { string } = {}
	for _, child in findMapsFolder():GetChildren() do
		if
			child:IsA("Model")
			and child.Name ~= arguments.mapId
			and child:GetAttribute(SNAPSHOT_ATTRIBUTE_NAME) ~= nil
		then
			table.insert(names, child.Name)
		end
	end
	table.sort(names)
	return names
end

local model = findMapModel()
local folder = findMapsFolder()
local remaining = otherStyledMaps()

if arguments.removing then
	local mapEncoded = model:GetAttribute(SNAPSHOT_ATTRIBUTE_NAME)
	local originalEncoded = folder:GetAttribute(ORIGINAL_ATTRIBUTE_NAME)
	local restored: string? = nil
	if typeof(mapEncoded) == "string" and #remaining == 0 then
		if typeof(originalEncoded) == "string" then
			restore(HttpService:JSONDecode(originalEncoded) :: Snapshot)
			folder:SetAttribute(ORIGINAL_ATTRIBUTE_NAME, nil)
			restored = "original"
		else
			restore(HttpService:JSONDecode(mapEncoded) :: Snapshot)
			restored = "map"
		end
	end
	return HttpService:JSONEncode({ restored = restored, remainingStyledMaps = remaining })
end

local encoded = model:GetAttribute(SNAPSHOT_ATTRIBUTE_NAME)
local recipe = arguments.recipe
local snapshotTaken = false
if typeof(encoded) == "string" then
	restore(HttpService:JSONDecode(encoded) :: Snapshot)
elseif recipe then
	snapshotTaken = true
	local snapshot = HttpService:JSONEncode(snapshotNow())
	model:SetAttribute(SNAPSHOT_ATTRIBUTE_NAME, snapshot)
	if folder:GetAttribute(ORIGINAL_ATTRIBUTE_NAME) == nil and #remaining == 0 then
		folder:SetAttribute(ORIGINAL_ATTRIBUTE_NAME, snapshot)
	end
end

if recipe then
	writeLighting(recipe)
	writeAtmosphere(effectOrNew("Atmosphere") :: Atmosphere, recipe.Atmosphere)
	writeBloom(effectOrNew("BloomEffect") :: BloomEffect, recipe.Bloom)
	local postRecipe = recipe.PostProcessing
	if postRecipe then
		for _, post in POST_EFFECTS do
			writeEffect(effectOrNew(post.className), postRecipe[post.key])
		end
	end
end

return HttpService:JSONEncode({ snapshotTaken = snapshotTaken })
