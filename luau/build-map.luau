--!strict
-- Builds one map as a Model named after its id under a Workspace folder, replacing the Model of
-- the same id and the terrain it filled. Each light record becomes a PointLight under an Attachment
-- under the floor part of its zone. Reports the number of parts built.
type Vector = { x: number, y: number, z: number }

type PartRecord = {
	name: string,
	kind: string,
	position: Vector,
	size: Vector,
	role: string,
	color: string,
	material: string,
}

type Variant = {
	baseMaterial: string,
	studsPerTile: number,
}

type LightRecord = {
	zone: string,
	part: string,
	role: string,
	position: Vector,
	range: number,
	shadows: boolean,
	brightness: number,
	color: string,
}

type TerrainFill = {
	shape: string,
	center: Vector,
	size: Vector?,
	radius: number?,
	material: string,
}

type Arguments = {
	mapId: string,
	mapsFolderName: string,
	parts: { PartRecord },
	terrainFills: { TerrainFill },
	-- Flat MaterialVariant of each surface role that has one.
	variants: { [string]: Variant },
	lights: { LightRecord },
}

-- Attribute on the map Model holding the terrain fills of its build as JSON, so a rebuild can clear them.
local TERRAIN_ATTRIBUTE_NAME = "RobloxKitTerrainFills"
-- Attribute on the map Model holding the Lighting snapshot; apply-lighting.luau owns it and a rebuild carries it over.
local SNAPSHOT_ATTRIBUTE_NAME = "RobloxKitLightingSnapshot"

local arguments: Arguments = ...
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local HttpService = game:GetService("HttpService")
local MaterialService = game:GetService("MaterialService")

local function toVector3(vector: Vector): Vector3
	return Vector3.new(vector.x, vector.y, vector.z)
end

-- Names the materials that Enum.Material does not know, so nothing is built from a bad spec.
local function assertMaterialsExist()
	local unknown: { string } = {}
	local function check(materialName: string)
		if Enum.Material:FromName(materialName) == nil and not table.find(unknown, materialName) then
			table.insert(unknown, materialName)
		end
	end
	for _, part in arguments.parts do
		check(part.material)
	end
	for _, fill in arguments.terrainFills do
		check(fill.material)
	end
	for _, variant in arguments.variants do
		check(variant.baseMaterial)
	end
	if #unknown > 0 then
		error(
			`Unknown Roblox material name(s): {table.concat(unknown, ", ")}. Use names from Enum.Material, such as Concrete or Grass.`,
			0
		)
	end
end

local function materialNamed(materialName: string): Enum.Material
	return (Enum.Material:FromName(materialName) :: any) :: Enum.Material
end

local function fillTerrain(fill: TerrainFill, material: Enum.Material)
	local size = fill.size
	local radius = fill.radius
	if size then
		workspace.Terrain:FillBlock(CFrame.new(toVector3(fill.center)), toVector3(size), material)
	elseif radius then
		workspace.Terrain:FillBall(toVector3(fill.center), radius, material)
	end
end

local function clearTerrainOf(oldModel: Model)
	local encoded = oldModel:GetAttribute(TERRAIN_ATTRIBUTE_NAME)
	if typeof(encoded) ~= "string" then
		return
	end
	local oldFills = HttpService:JSONDecode(encoded) :: { TerrainFill }
	for _, fill in oldFills do
		fillTerrain(fill, Enum.Material.Air)
	end
end

local function mapsFolder(): Instance
	local existing = workspace:FindFirstChild(arguments.mapsFolderName)
	if existing then
		return existing
	end
	local folder = Instance.new("Folder")
	folder.Name = arguments.mapsFolderName
	folder.Parent = workspace
	return folder
end

-- The MaterialVariant of a role, named after the map and role; a rebuild reuses it and refreshes its values.
local function variantFor(role: string, variant: Variant): MaterialVariant
	local variantName = `{arguments.mapId}-{role}`
	local existing = MaterialService:FindFirstChild(variantName)
	local materialVariant = if existing and existing:IsA("MaterialVariant")
		then existing
		else Instance.new("MaterialVariant")
	materialVariant.Name = variantName
	materialVariant.BaseMaterial = materialNamed(variant.baseMaterial)
	materialVariant.StudsPerTile = variant.studsPerTile
	materialVariant.Parent = MaterialService
	return materialVariant
end

-- A variant only renders on a part whose Material is the variant's base material.
local function applyVariant(part: BasePart, record: PartRecord)
	local variant = arguments.variants[record.role]
	if variant and variant.baseMaterial == record.material then
		part.MaterialVariant = variantFor(record.role, variant).Name
	end
end

local function newPart(record: PartRecord): BasePart
	local part: BasePart = if record.kind == "spawn" then Instance.new("SpawnLocation") else Instance.new("Part")
	part.Name = record.name
	part.Anchored = true
	part.Size = toVector3(record.size)
	part.Position = toVector3(record.position)
	part.Material = materialNamed(record.material)
	part.Color = Color3.fromHex(record.color)
	applyVariant(part, record)
	return part
end

-- A light hangs from an Attachment on its zone's floor part, so it adds no part to the map.
local function addLight(model: Model, record: LightRecord)
	local floor = model:FindFirstChild(record.part)
	if not floor or not floor:IsA("BasePart") then
		error(`Light "{record.role}" of zone "{record.zone}" has no floor part named "{record.part}".`, 0)
	end
	local attachment = Instance.new("Attachment")
	attachment.Name = `{record.zone}-{record.role}-light`
	attachment.Parent = floor
	attachment.WorldPosition = toVector3(record.position)
	local light = Instance.new("PointLight")
	light.Range = record.range
	light.Brightness = record.brightness
	light.Color = Color3.fromHex(record.color)
	light.Shadows = record.shadows
	light.Parent = attachment
end

-- Returns whether a map of this id was replaced and how many parts the new one holds.
local function build(): (boolean, number)
	local folder = mapsFolder()
	local oldModel = folder:FindFirstChild(arguments.mapId)
	if oldModel and oldModel:IsA("Model") then
		clearTerrainOf(oldModel)
	end
	local lightingSnapshot = if oldModel then oldModel:GetAttribute(SNAPSHOT_ATTRIBUTE_NAME) else nil
	if oldModel then
		oldModel:Destroy()
	end

	local model = Instance.new("Model")
	model.Name = arguments.mapId
	if typeof(lightingSnapshot) == "string" then
		model:SetAttribute(SNAPSHOT_ATTRIBUTE_NAME, lightingSnapshot)
	end
	for _, record in arguments.parts do
		newPart(record).Parent = model
	end
	for _, record in arguments.lights do
		addLight(model, record)
	end
	for _, fill in arguments.terrainFills do
		fillTerrain(fill, materialNamed(fill.material))
	end
	model:SetAttribute(TERRAIN_ATTRIBUTE_NAME, HttpService:JSONEncode(arguments.terrainFills))
	model.Parent = folder
	return oldModel ~= nil, #model:GetChildren()
end

assertMaterialsExist()

-- Under execute_luau ChangeHistoryService is disabled and this is nil (research: TryBeginRecording returns nil), so the
-- build runs unrecorded; the recording is kept for a Studio that allows it.
local recordingStarted, recordingId = pcall(function()
	return ChangeHistoryService:TryBeginRecording("roblox-kit build_map", "Build map " .. arguments.mapId)
end)
local recording: string? = if recordingStarted and typeof(recordingId) == "string" then recordingId else nil

local built, replacedOrError, partCount = pcall(build)
if recording then
	local operation = if built then Enum.FinishRecordingOperation.Commit else Enum.FinishRecordingOperation.Cancel
	ChangeHistoryService:FinishRecording(recording, operation)
end
if not built then
	local undoNote = if recording
		then "The build was cancelled and undone."
		else "No undo recording was open, so nothing was undone."
	error(`Building map "{arguments.mapId}" failed: {tostring(replacedOrError)}. {undoNote}`, 0)
end

return HttpService:JSONEncode({ partCount = partCount, replaced = replacedOrError })
