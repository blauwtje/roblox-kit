--!strict
-- Builds one phase of one map; build_map calls it once per phase, in order, with the phase name in
-- `arguments.phase`. The shell phase replaces the Model of the same id and the terrain it filled and
-- adds the walls and terrain; the later phases find that Model and add to it: floors, spawns and
-- ceilings, then doorway arches, then trim details, then props, then lights. Each light record becomes
-- a PointLight under an Attachment under the floor part of its zone; a light within `ceilingDropStuds` of
-- the ceiling above it also gets a Neon fixture part against that ceiling, tagged like the ceilings.
-- Ceilings are tagged and decorative, as are the detail parts and fixtures. Each prop becomes a ProceduralModel running the ModuleScript of its kind
-- under the Model, generated before the props phase returns. Reports the number of parts in the Model
-- after the phase (the BaseParts that are children of the Model); the shell phase also reports
-- whether it replaced a map.
type Vector = { x: number, y: number, z: number }

type PartRecord = {
	name: string,
	kind: string,
	position: Vector,
	size: Vector,
	role: string,
	color: string,
	material: string,
	-- Present and false on a decorative detail part.
	canCollide: boolean?,
}

type PropRecord = {
	kind: string,
	pivot: Vector,
	size: Vector,
	seed: number,
	-- A set piece also turns by `yaw` degrees about Y and sets its `attributes`; a name ending in "Color" holds a hex color.
	yaw: number?,
	attributes: { [string]: string }?,
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
	phase: string,
	mapId: string,
	mapsFolderName: string,
	-- Every material name of the whole build; the shell phase checks them before anything is built.
	materials: { string }?,
	-- The parts this phase adds: walls, floors, spawns and ceilings, or detail parts.
	parts: { PartRecord }?,
	props: { PropRecord }?,
	-- Source text of the generator of each prop kind.
	generators: { [string]: string }?,
	ceilingTag: string?,
	-- Lighting phase: how far below a ceiling a light may hang to get a fixture, and the fixture's side.
	ceilingDropStuds: number?,
	fixtureSizeStuds: number?,
	terrainFills: { TerrainFill }?,
	-- Flat MaterialVariant of each surface role that has one.
	variants: { [string]: Variant }?,
	lights: { LightRecord }?,
}

-- Attribute on the map Model holding the terrain fills of its build as JSON, so a rebuild can clear them.
local TERRAIN_ATTRIBUTE_NAME = "RobloxKitTerrainFills"
-- Attribute on the map Model holding the Lighting snapshot; apply-lighting.luau owns it and a rebuild carries it over.
local SNAPSHOT_ATTRIBUTE_NAME = "RobloxKitLightingSnapshot"
local FIXTURE_TOLERANCE_STUDS = 0.001

local arguments: Arguments = ...
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local MaterialService = game:GetService("MaterialService")

local function toVector3(vector: Vector): Vector3
	return Vector3.new(vector.x, vector.y, vector.z)
end

-- Names the materials that Enum.Material does not know, so nothing is built from a bad spec.
local function assertMaterialsExist()
	local unknown: { string } = {}
	for _, materialName in arguments.materials or {} do
		if Enum.Material:FromName(materialName) == nil and not table.find(unknown, materialName) then
			table.insert(unknown, materialName)
		end
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
	local variant = (arguments.variants or {})[record.role]
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
	if record.kind == "ceiling" then
		local ceilingTag = arguments.ceilingTag
		if not ceilingTag then
			error("A ceiling part needs ceilingTag.", 0)
		end
		CollectionService:AddTag(part, ceilingTag)
	end
	if record.kind == "ceiling" or record.canCollide == false then
		part.CanCollide = false
		part.CanTouch = false
		part.CanQuery = false
	end
	return part
end

-- One ModuleScript per prop kind in use, each holding the generator source of its kind.
local function addGenerators(model: Model): { [string]: ModuleScript }
	local modules: { [string]: ModuleScript } = {}
	for kind, source in arguments.generators or {} do
		local generator = Instance.new("ModuleScript")
		generator.Name = `{kind}-generator`
		generator.Source = source
		generator.Parent = model
		modules[kind] = generator
	end
	return modules
end

-- The ProceduralModels of the props, named "<kind>-<n>" in placement order, sharing their kind's generator.
local function addProps(model: Model, generators: { [string]: ModuleScript }): { ProceduralModel }
	local proceduralModels: { ProceduralModel } = {}
	local countByKind: { [string]: number } = {}
	for _, record in arguments.props or {} do
		local generator = generators[record.kind]
		if not generator then
			error(`Prop kind "{record.kind}" has no generator source.`, 0)
		end
		local count = (countByKind[record.kind] or 0) + 1
		countByKind[record.kind] = count
		local proceduralModel = Instance.new("ProceduralModel")
		proceduralModel.Name = `{record.kind}-{count}`
		proceduralModel.Generator = generator
		proceduralModel.Size = toVector3(record.size)
		proceduralModel:SetAttribute("Seed", record.seed)
		for name, value in record.attributes or {} do
			proceduralModel:SetAttribute(name, if string.match(name, "Color$") then Color3.fromHex(value) else value)
		end
		local turn = CFrame.Angles(0, math.rad(record.yaw or 0), 0)
		proceduralModel:PivotTo(CFrame.new(toVector3(record.pivot)) * turn)
		proceduralModel.Parent = model
		table.insert(proceduralModels, proceduralModel)
	end
	return proceduralModels
end

-- Generation runs once the model is in the place; a generator error fails the build.
local function waitForGeneration(proceduralModels: { ProceduralModel })
	for _, proceduralModel in proceduralModels do
		proceduralModel:WaitForGenerationAsync()
		local generationError = proceduralModel.GenerationError
		if generationError ~= "" then
			error(`Prop "{proceduralModel.Name}" failed to generate: {generationError}`, 0)
		end
	end
end

local function countPartChildren(model: Model): number
	local count = 0
	for _, child in model:GetChildren() do
		if child:IsA("BasePart") then
			count += 1
		end
	end
	return count
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

-- The bottom face height of the tagged ceiling over the point, if any.
local function ceilingBottomOver(model: Model, position: Vector, ceilingTag: string): number?
	for _, tagged in CollectionService:GetTagged(ceilingTag) do
		if tagged:IsDescendantOf(model) and tagged:IsA("BasePart") then
			local offset = tagged.CFrame:PointToObjectSpace(toVector3(position))
			if math.abs(offset.X) <= tagged.Size.X / 2 and math.abs(offset.Z) <= tagged.Size.Z / 2 then
				return tagged.Position.Y - tagged.Size.Y / 2
			end
		end
	end
	return nil
end

-- A Neon cube against the ceiling over a light within the drop of it; it hides with the ceilings by their tag.
local function addFixture(model: Model, record: LightRecord)
	local ceilingTag, dropStuds, sizeStuds =
		arguments.ceilingTag, arguments.ceilingDropStuds, arguments.fixtureSizeStuds
	if not ceilingTag or not dropStuds or not sizeStuds then
		error("A lighting phase needs ceilingTag, ceilingDropStuds and fixtureSizeStuds.", 0)
	end
	local ceilingBottom = ceilingBottomOver(model, record.position, ceilingTag)
	-- Studio positions carry float error, so the drop is compared with a tolerance.
	if not ceilingBottom or ceilingBottom - record.position.y > dropStuds + FIXTURE_TOLERANCE_STUDS then
		return
	end
	local fixture = Instance.new("Part")
	fixture.Name = `{record.zone}-{record.role}-fixture`
	fixture.Anchored = true
	fixture.CanCollide = false
	fixture.CanTouch = false
	fixture.CanQuery = false
	fixture.Material = Enum.Material.Neon
	fixture.Color = Color3.fromHex(record.color)
	fixture.Size = Vector3.new(sizeStuds, sizeStuds, sizeStuds)
	fixture.Position = Vector3.new(record.position.x, ceilingBottom - sizeStuds / 2, record.position.z)
	CollectionService:AddTag(fixture, ceilingTag)
	fixture.Parent = model
end

local function findModel(): Model
	local folder = workspace:FindFirstChild(arguments.mapsFolderName)
	local model = if folder then folder:FindFirstChild(arguments.mapId) else nil
	if not model or not model:IsA("Model") then
		error(
			`Map "{arguments.mapId}" is not under Workspace.{arguments.mapsFolderName}; the shell phase builds it first.`,
			0
		)
	end
	return model
end

local function addLights(model: Model)
	for _, record in arguments.lights or {} do
		addLight(model, record)
		addFixture(model, record)
	end
end

local function addParts(model: Model)
	for _, record in arguments.parts or {} do
		newPart(record).Parent = model
	end
end

local function addPropModels(model: Model)
	local proceduralModels = addProps(model, addGenerators(model))
	waitForGeneration(proceduralModels)
end

-- Replaces the map of this id with a new Model holding the walls and the terrain; returns whether it replaced one.
local function buildShell(): (boolean, number)
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
	addParts(model)
	local terrainFills = arguments.terrainFills or {}
	for _, fill in terrainFills do
		fillTerrain(fill, materialNamed(fill.material))
	end
	model:SetAttribute(TERRAIN_ATTRIBUTE_NAME, HttpService:JSONEncode(terrainFills))
	model.Parent = folder
	return oldModel ~= nil, countPartChildren(model)
end

-- Runs the phase named in the arguments; returns whether the shell replaced a map (nil for later phases) and the Model's part count.
local function runPhase(): (boolean?, number)
	local phase = arguments.phase
	if phase == "shell" then
		return buildShell()
	end
	local model = findModel()
	if phase == "floors and ceilings" or phase == "openings" or phase == "surfaces" then
		addParts(model)
	elseif phase == "props" then
		addPropModels(model)
	elseif phase == "lighting" then
		addLights(model)
	else
		error(`Unknown build phase "{phase}".`, 0)
	end
	return nil, countPartChildren(model)
end

assertMaterialsExist()

-- Under execute_luau ChangeHistoryService is disabled and this is nil (research: TryBeginRecording returns nil), so the
-- build runs unrecorded; the recording is kept for a Studio that allows it.
local recordingStarted, recordingId = pcall(function()
	return ChangeHistoryService:TryBeginRecording(
		"roblox-kit build_map",
		`Build map {arguments.mapId}: {arguments.phase}`
	)
end)
local recording: string? = if recordingStarted and typeof(recordingId) == "string" then recordingId else nil

local built, replacedOrError, partCount = pcall(runPhase)
if recording then
	local operation = if built then Enum.FinishRecordingOperation.Commit else Enum.FinishRecordingOperation.Cancel
	ChangeHistoryService:FinishRecording(recording, operation)
end
if not built then
	local undoNote = if recording
		then "The phase was cancelled and undone."
		else "No undo recording was open, so nothing was undone."
	error(
		`Building map "{arguments.mapId}" failed in the "{arguments.phase}" phase: {tostring(replacedOrError)}. {undoNote}`,
		0
	)
end

return HttpService:JSONEncode({ partCount = partCount, replaced = replacedOrError })
