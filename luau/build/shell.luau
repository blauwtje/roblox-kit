--!strict
-- The shell phase of build_map, and the terrain phase that follows it. The shell phase replaces the Model of the
-- same id and the terrain it filled and adds the walls and terrain; the terrain phase writes one chunk of a
-- heightmap fill per call. Reports the number of parts in the Model after the phase (the BaseParts that are
-- children of the Model); the shell phase also reports whether it replaced a map.
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

type VariantMaps = {
	color: string,
	normal: string,
	roughness: string,
	metalness: string,
}

type Variant = {
	baseMaterial: string,
	studsPerTile: number,
	maps: VariantMaps?,
	materialPattern: string?,
}

-- One rectangle of heightmap columns: the heights and surface layers of `columns` by `rows` voxel columns.
type TerrainChunk = {
	origin: Vector,
	columns: number,
	rows: number,
	voxelsY: number,
	voxelStuds: number,
	baseMaterial: string,
	layerMaterials: { string },
	-- Per column (`column * rows + row`, both 0-based) the 0-based index into layerMaterials, and the surface height.
	surface: { number },
	heights: { number },
}

type TerrainOverride = {
	material: string,
	role: string,
}

type TerrainFill = {
	shape: string,
	center: Vector,
	size: Vector?,
	radius: number?,
	material: string,
}

type Arguments = {
	-- "shell" or "terrain".
	phase: string,
	mapId: string,
	mapsFolderName: string,
	-- Every material name of the whole build; the shell phase checks them before anything is built.
	materials: { string }?,
	-- The walls the shell phase adds.
	parts: { PartRecord }?,
	ceilingTag: string?,
	terrainFills: { TerrainFill }?,
	terrainChunk: TerrainChunk?,
	-- Flat MaterialVariant of each surface role that has one.
	variants: { [string]: Variant }?,
	-- Terrain materials drawn with the MaterialVariant of a role.
	terrainOverrides: { TerrainOverride }?,
}

-- Attribute on the map Model holding the terrain fills of its build as JSON, so a rebuild can clear them.
local TERRAIN_ATTRIBUTE_NAME = "RobloxKitTerrainFills"
-- Attribute on the map Model holding the Lighting snapshot; apply-lighting.luau owns it and a rebuild carries it over.
local SNAPSHOT_ATTRIBUTE_NAME = "RobloxKitLightingSnapshot"

local arguments: Arguments = ...
local HttpService = game:GetService("HttpService")
local MaterialService = game:GetService("MaterialService")
local buildPrelude = require("./prelude")
local kit = buildPrelude(arguments)
local buildPartKit = require("./part-kit")
local partKit = buildPartKit(arguments, kit)

-- Names the materials that Enum.Material does not know, so nothing is built from a bad spec.
local function assertMaterialsExist()
	local unknown: { string } = {}
	for _, materialName in arguments.materials or ({} :: { string }) do
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

-- Fills a block or ball; a heightmap is written by writeTerrainChunk, and its box clears like a block.
local function fillTerrain(fill: TerrainFill, material: Enum.Material)
	local size = fill.size
	local radius = fill.radius
	if size then
		workspace.Terrain:FillBlock(CFrame.new(kit.toVector3(fill.center)), kit.toVector3(size), material)
	elseif radius then
		workspace.Terrain:FillBall(kit.toVector3(fill.center), radius, material)
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

-- The surface roles of a preset; a map's variants are named `<mapId>-<role>` (remove-map.luau takes the same list as an argument).
local SURFACE_ROLES = { "floor", "wall", "trim", "ceiling", "accent" }

-- Clears every terrain material override that points at one of this map's variants, so a rebuild keeps no stale one.
local function clearTerrainOverrides()
	local ownNames: { [string]: boolean } = {}
	for _, role in SURFACE_ROLES do
		ownNames[`{arguments.mapId}-{role}`] = true
	end
	for _, material in Enum.Material:GetEnumItems() do
		-- Reading the override of a material Studio does not support (Neon, Glass) errors; such a material has none.
		local found, overrideName = pcall(function()
			return MaterialService:GetBaseMaterialOverride(material)
		end)
		if found and ownNames[overrideName] then
			MaterialService:SetBaseMaterialOverride(material, "")
		end
	end
end

-- Draws each named terrain material with the MaterialVariant of its role.
local function applyTerrainOverrides()
	clearTerrainOverrides()
	local variants = arguments.variants or {}
	for _, override in arguments.terrainOverrides or ({} :: { TerrainOverride }) do
		local variant = variants[override.role]
		if variant then
			MaterialService:SetBaseMaterialOverride(
				kit.materialNamed(override.material),
				partKit.variantFor(override.role, variant).Name
			)
		end
	end
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
	partKit.addParts(model, arguments.parts)
	local terrainFills = arguments.terrainFills or ({} :: { TerrainFill })
	for _, fill in terrainFills do
		if fill.shape ~= "heightmap" then
			fillTerrain(fill, kit.materialNamed(fill.material))
		end
	end
	model:SetAttribute(TERRAIN_ATTRIBUTE_NAME, HttpService:JSONEncode(terrainFills))
	applyTerrainOverrides()
	model.Parent = folder
	return oldModel ~= nil, kit.countPartChildren(model)
end

-- Writes one chunk of a heightmap fill: full voxels up to the surface, a part-filled top voxel, the top voxel's material
-- from the column's surface layer and the base material below it.
local function writeTerrainChunk(chunk: TerrainChunk)
	local stud = chunk.voxelStuds
	local base = kit.materialNamed(chunk.baseMaterial)
	local layers: { Enum.Material } = {}
	for _, name in chunk.layerMaterials do
		table.insert(layers, kit.materialNamed(name))
	end
	local materials = table.create(chunk.columns)
	local occupancies = table.create(chunk.columns)
	for column = 1, chunk.columns do
		materials[column] = table.create(chunk.voxelsY)
		occupancies[column] = table.create(chunk.voxelsY)
		for level = 1, chunk.voxelsY do
			materials[column][level] = table.create(chunk.rows, Enum.Material.Air)
			occupancies[column][level] = table.create(chunk.rows, 0)
		end
		for row = 1, chunk.rows do
			local index = (column - 1) * chunk.rows + row
			local height = chunk.heights[index]
			local surfaceMaterial = layers[chunk.surface[index] + 1]
			for level = 1, chunk.voxelsY do
				local bottom = (level - 1) * stud
				local fill = math.clamp((height - bottom) / stud, 0, 1)
				if fill > 0 then
					materials[column][level][row] = if height <= bottom + stud then surfaceMaterial else base
					occupancies[column][level][row] = fill
				end
			end
		end
	end
	local minimum = kit.toVector3(chunk.origin)
	local size = Vector3.new(chunk.columns, chunk.voxelsY, chunk.rows) * stud
	workspace.Terrain:WriteVoxels(Region3.new(minimum, minimum + size), stud, materials, occupancies)
end

assertMaterialsExist()

return kit.run(function()
	if arguments.phase == "shell" then
		return buildShell()
	end
	if arguments.phase ~= "terrain" then
		error(`Unknown build phase "{arguments.phase}".`, 0)
	end
	local model = kit.findModel()
	writeTerrainChunk(arguments.terrainChunk :: TerrainChunk)
	return nil, kit.countPartChildren(model), nil
end)
