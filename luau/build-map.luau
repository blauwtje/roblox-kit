--!strict
-- Builds one phase of one map; build_map calls it once per phase, in order, with the phase name in
-- `arguments.phase`. The shell phase replaces the Model of the same id and the terrain it filled and
-- adds the walls and terrain; the later phases find that Model and add to it: floors, spawns and
-- ceilings, then doorway arches, then trim details, then props, then lights. Each light record becomes
-- a PointLight under an Attachment under its fixture box, a Neon part tagged like the ceilings only for a
-- pendant, or without one under the floor part of its zone; a light without a box within `ceilingDropStuds` of
-- the ceiling above it also gets a Neon fixture part against that ceiling, tagged like the ceilings.
-- Ceilings are tagged and decorative, as are the detail parts and fixtures. Each prop becomes a ProceduralModel running the ModuleScript of its kind
-- under the Model, generated before the props phase returns. Each hero prop is its uploaded asset loaded with
-- InsertService into a Model named "<kind>-hero-<n>", scaled to its size, centered on its pivot and turned by its
-- yaw, its MeshParts colored from the surface each is named after, anchored and decorative; an asset that fails to load
-- builds the set piece it replaced and is reported in `heroLoadFailures`. Reports the number of parts in the Model
-- after the phase (the BaseParts that are children of the Model); the shell phase also reports
-- whether it replaced a map. The ambient effects phase hangs each effect record's ParticleEmitter, or Beam
-- between two Attachments, under its zone's floor part; it adds no parts and an empty texture leaves the
-- emitter untextured. A prop kind listed in `idleAnimations` gets the sway attributes on each of its ProceduralModels,
-- and the props phase then adds one server Script holding `idleScript` under the Model, which sways them during play.
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

type HeroPropRecord = {
	kind: string,
	assetId: string,
	-- Center of the hero's box; `size.x` is the width it is scaled to, and `yaw` its turn in degrees about Y.
	pivot: Vector,
	yaw: number,
	size: Vector,
	-- Hex color and material name of each surface role a MeshPart may be named after.
	surfaces: { [string]: { color: string, material: string } },
	-- The set piece built instead when the asset fails to load; a trim mesh has `fallbackPart` (its box) instead.
	fallback: PropRecord?,
	fallbackPart: PartRecord?,
	-- Degrees about the mesh's own x axis, applied after the yaw: 180 turns a cornice over, -90 stands a jamb up.
	roll: number?,
	-- Studs of bevel of each surface role's mesh; the smallest of its shapes, 0 for a shape with none. Absent: no bevel rule.
	bevels: { [string]: number }?,
	-- "stretch" (a prop kind's mesh) scales the asset to `size` on each axis, not evenly to `size.x`.
	fit: string?,
}

type HeroLoadFailure = { kind: string, assetId: string, error: string }

-- The ContentIds of a variant's baked maps (rbxassetid://<id>), uploaded by `npm run materials`.
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

type LightRecord = {
	zone: string,
	part: string,
	role: string,
	position: Vector,
	range: number,
	shadows: boolean,
	-- The visible box that holds the light; a pendant hangs from the ceiling and hides with it.
	fixture: { position: Vector, size: Vector, pendant: boolean }?,
	brightness: number,
	color: string,
}

type AmbientEffectRecord = {
	kind: string,
	name: string,
	zone: string,
	part: string,
	color: string,
	transparency: number,
	lightEmission: number,
	position: Vector,
	-- Beam only: the east end, and the width.
	endPosition: Vector?,
	widthStuds: number?,
	-- Particles only.
	rate: number?,
	lifetimeSeconds: number?,
	sizeStuds: number?,
	speedStuds: number?,
	texture: string?,
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

-- How one prop kind sways during play; see luau/idle-animation.luau.
type IdleAnimation = {
	swayDegrees: number,
	periodSeconds: number,
	hinge: string,
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
	heroProps: { HeroPropRecord }?,
	ceilingTag: string?,
	-- Props phase: a prop whose largest side is under this casts no shadow.
	noShadowSizeStuds: number?,
	-- Lighting phase: how far below a ceiling a light may hang to get a fixture, and the fixture's side.
	ceilingDropStuds: number?,
	fixtureSizeStuds: number?,
	terrainFills: { TerrainFill }?,
	terrainChunk: TerrainChunk?,
	-- Flat MaterialVariant of each surface role that has one.
	variants: { [string]: Variant }?,
	-- Terrain materials drawn with the MaterialVariant of a role.
	terrainOverrides: { TerrainOverride }?,
	lights: { LightRecord }?,
	effects: { AmbientEffectRecord }?,
	-- Props phase: the idle sway of each animated prop kind, and the server Script source that runs it.
	idleAnimations: { [string]: IdleAnimation }?,
	idleScript: string?,
}

-- Attribute on the map Model holding the terrain fills of its build as JSON, so a rebuild can clear them.
local TERRAIN_ATTRIBUTE_NAME = "RobloxKitTerrainFills"
-- Attribute on the map Model holding the Lighting snapshot; apply-lighting.luau owns it and a rebuild carries it over.
local SNAPSHOT_ATTRIBUTE_NAME = "RobloxKitLightingSnapshot"
local FIXTURE_TOLERANCE_STUDS = 0.001
-- Attribute naming a hero Model's kind; check-map.luau finds hero Models by it.
local HERO_KIND_ATTRIBUTE_NAME = "RobloxKitHeroKind"
-- Attribute on a hero MeshPart holding its bevel in studs; read-props.luau reports it.
local BEVEL_ATTRIBUTE_NAME = "RobloxKitBevel"
-- Name of the server Script that runs the idle sway; idle-animation.luau reads the three attributes below.
local IDLE_SCRIPT_NAME = "RobloxKitIdleAnimation"

local arguments: Arguments = ...
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local InsertService = game:GetService("InsertService")
local MaterialService = game:GetService("MaterialService")

local function toVector3(vector: Vector): Vector3
	return Vector3.new(vector.x, vector.y, vector.z)
end

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

local function materialNamed(materialName: string): Enum.Material
	return (Enum.Material:FromName(materialName) :: any) :: Enum.Material
end

-- Fills a block or ball; a heightmap is written by writeTerrainChunk, and its box clears like a block.
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

-- The MaterialVariant of each role this run has made: every part of a role shares the one instance.
local variantByRole: { [string]: MaterialVariant } = {}

-- The MaterialVariant of a role, named after the map and role; a rebuild reuses it and refreshes its values.
local function variantFor(role: string, variant: Variant): MaterialVariant
	local made = variantByRole[role]
	if made then
		return made
	end
	local variantName = `{arguments.mapId}-{role}`
	local existing = MaterialService:FindFirstChild(variantName)
	local materialVariant = if existing and existing:IsA("MaterialVariant")
		then existing
		else Instance.new("MaterialVariant")
	materialVariant.Name = variantName
	materialVariant.BaseMaterial = materialNamed(variant.baseMaterial)
	materialVariant.StudsPerTile = variant.studsPerTile
	-- Without maps the variant renders flat color; a rebuild without them clears earlier maps.
	local maps = variant.maps
	materialVariant.ColorMap = if maps then maps.color else ""
	materialVariant.NormalMap = if maps then maps.normal else ""
	materialVariant.RoughnessMap = if maps then maps.roughness else ""
	materialVariant.MetalnessMap = if maps then maps.metalness else ""
	-- The preset picks the pattern; Organic breaks the repeat of a tiled texture, so it is never forced.
	materialVariant.MaterialPattern = if variant.materialPattern == "Organic"
		then Enum.MaterialPattern.Organic
		else Enum.MaterialPattern.Regular
	materialVariant.Parent = MaterialService
	variantByRole[role] = materialVariant
	return materialVariant
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
				materialNamed(override.material),
				variantFor(override.role, variant).Name
			)
		end
	end
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
	if record.kind ~= "ceiling" and record.canCollide == false then
		-- A trim detail is thin ornament, so it casts no shadow.
		part.CastShadow = false
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
	for kind, source in arguments.generators or ({} :: { [string]: string }) do
		local generator = Instance.new("ModuleScript")
		generator.Name = `{kind}-generator`
		generator.Source = source
		generator.Parent = model
		modules[kind] = generator
	end
	return modules
end

-- Gives a prop of a kind listed in `idleAnimations` the sway attributes idle-animation.luau reads, whether it is a
-- ProceduralModel or the Model of its mesh; a prop of any other kind is left as it is.
local function setIdleSway(prop: Model, kind: string)
	local idle = (arguments.idleAnimations or ({} :: { [string]: IdleAnimation }))[kind]
	if idle then
		prop:SetAttribute("IdleSwayDegrees", idle.swayDegrees)
		prop:SetAttribute("IdlePeriodSeconds", idle.periodSeconds)
		prop:SetAttribute("IdleHinge", idle.hinge)
	end
end

-- One ProceduralModel named "<kind>-<n>" sharing the generator of its kind; `countByKind` numbers them in placement order.
local function addProp(
	model: Model,
	generators: { [string]: ModuleScript },
	record: PropRecord,
	countByKind: { [string]: number }
): ProceduralModel
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
	for name, value in record.attributes or ({} :: { [string]: string }) do
		proceduralModel:SetAttribute(name, if string.match(name, "Color$") then Color3.fromHex(value) else value)
	end
	setIdleSway(proceduralModel, record.kind)
	local turn = CFrame.Angles(0, math.rad(record.yaw or 0), 0)
	proceduralModel:PivotTo(CFrame.new(toVector3(record.pivot)) * turn)
	proceduralModel.Parent = model
	return proceduralModel
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

-- A Neon box in the light's color; only a pendant is tagged, so cutaways hide it with the ceilings.
local function addFixtureBox(model: Model, record: LightRecord, fixtureNumber: number): Part
	local box = record.fixture
	local ceilingTag = arguments.ceilingTag
	if not box or not ceilingTag then
		error("A fixture box needs its record's fixture and ceilingTag.", 0)
	end
	local fixture = Instance.new("Part")
	fixture.Name = `{record.zone}-{record.role}-fixture-{fixtureNumber}`
	fixture.Anchored = true
	fixture.CanCollide = false
	fixture.CanTouch = false
	fixture.CanQuery = false
	fixture.CastShadow = false
	fixture.Material = Enum.Material.Neon
	fixture.Color = Color3.fromHex(record.color)
	fixture.Size = toVector3(box.size)
	fixture.Position = toVector3(box.position)
	if box.pendant then
		CollectionService:AddTag(fixture, ceilingTag)
	end
	fixture.Parent = model
	return fixture
end

-- A light hangs from an Attachment on its fixture box when it has one, else on its zone's floor part, which adds no part.
local function addLight(model: Model, record: LightRecord, fixtureNumber: number)
	local holder = model:FindFirstChild(record.part)
	if record.fixture then
		holder = addFixtureBox(model, record, fixtureNumber)
	end
	if not holder or not holder:IsA("BasePart") then
		error(`Light "{record.role}" of zone "{record.zone}" has no floor part named "{record.part}".`, 0)
	end
	local attachment = Instance.new("Attachment")
	attachment.Name = `{record.zone}-{record.role}-light`
	attachment.Parent = holder
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
	fixture.CastShadow = false
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
	local fixtureCount = 0
	for _, record in arguments.lights or ({} :: { LightRecord }) do
		if record.fixture then
			fixtureCount += 1
		end
		addLight(model, record, fixtureCount)
		if not record.fixture then
			addFixture(model, record)
		end
	end
end

local function addParts(model: Model)
	for _, record in arguments.parts or ({} :: { PartRecord }) do
		newPart(record).Parent = model
	end
end

-- Sets one hero MeshPart's material from the surface its name names, and its color too unless the asset embeds
-- baked maps (the GLB importer made a SurfaceAppearance, which the part's Color would not tint);
-- a name that names no surface fails the build.
local function paintHeroPart(part: MeshPart, record: HeroPropRecord)
	local surface = record.surfaces[part.Name]
	if not surface then
		local roles = {}
		for role in record.surfaces do
			table.insert(roles, role)
		end
		table.sort(roles)
		local known = table.concat(roles, ", ")
		error(
			`Hero prop {record.kind} (asset {record.assetId}) has a MeshPart named "{part.Name}", which names none of its surfaces: {known}.`,
			0
		)
	end
	if not part:FindFirstChildOfClass("SurfaceAppearance") then
		part.Color = Color3.fromHex(surface.color)
	end
	part.Material = materialNamed(surface.material)
	if record.bevels then
		part:SetAttribute(BEVEL_ATTRIBUTE_NAME, record.bevels[part.Name] or 0)
	end
end

-- Scales a loaded asset to `record.size` on each axis about its bounding-box center: each part's size and its
-- offset from that center; the asset's parts are assumed square to its box, as the GLB importer leaves them.
local function stretchHero(hero: Model, extents: Vector3, record: HeroPropRecord)
	if extents.Y <= 0 or extents.Z <= 0 then
		error(`Hero prop {record.kind} (asset {record.assetId}) has no height or depth to stretch.`, 0)
	end
	local center = hero:GetBoundingBox()
	local factor = Vector3.new(record.size.x / extents.X, record.size.y / extents.Y, record.size.z / extents.Z)
	for _, descendant in hero:GetDescendants() do
		if descendant:IsA("BasePart") then
			local offset = center:PointToObjectSpace(descendant.Position) * factor
			local rotation = descendant.CFrame - descendant.Position
			descendant.Size = descendant.Size * factor
			descendant.CFrame = CFrame.new(center:PointToWorldSpace(offset)) * rotation
		end
	end
end

-- The hero props, each its asset loaded into a Model named "<kind>-hero-<n>", scaled so its width is `size.x`
-- (or to `size` on each axis when its fit is "stretch"),
-- centered on its pivot and turned by its yaw; every part is anchored and neither collides, touches nor is queried.
-- An asset that fails to load builds its fallback set piece instead, added to `proceduralModels`; returns those failures.
local function addHeroProps(
	model: Model,
	generators: { [string]: ModuleScript },
	countByKind: { [string]: number },
	proceduralModels: { ProceduralModel }
): { HeroLoadFailure }
	local failures: { HeroLoadFailure } = {}
	local heroCountByKind: { [string]: number } = {}
	-- Each asset is loaded once; a repeat clones it, so its parts keep the same texture ids and share one draw call.
	local loadedByAssetId: { [number]: Model } = {}
	for _, record in arguments.heroProps or ({} :: { HeroPropRecord }) do
		local assetId = tonumber(record.assetId)
		if not assetId then
			error(`Hero prop {record.kind} has the asset id "{record.assetId}", which is not a number.`, 0)
		end
		local loaded, heroOrError = pcall(function()
			local template = loadedByAssetId[assetId]
			if template then
				return template:Clone() :: Model
			end
			-- LoadAsset is typed as Instance but returns the Model that holds the asset.
			local asset = InsertService:LoadAsset(assetId) :: Model
			loadedByAssetId[assetId] = asset:Clone() :: Model
			return asset
		end)
		if not loaded then
			table.insert(failures, { kind = record.kind, assetId = record.assetId, error = tostring(heroOrError) })
			if record.fallback then
				table.insert(proceduralModels, addProp(model, generators, record.fallback, countByKind))
			elseif record.fallbackPart then
				newPart(record.fallbackPart).Parent = model
			end
			continue
		end
		local hero = heroOrError :: Model
		local _, extents = hero:GetBoundingBox()
		if extents.X <= 0 then
			error(`Hero prop {record.kind} (asset {record.assetId}) has no width to scale.`, 0)
		end
		if record.fit == "stretch" then
			stretchHero(hero, extents, record)
		else
			hero:ScaleTo(hero:GetScale() * record.size.x / extents.X)
		end
		for _, descendant in hero:GetDescendants() do
			if descendant:IsA("BasePart") then
				descendant.Anchored = true
				descendant.CanCollide = false
				descendant.CanTouch = false
				descendant.CanQuery = false
				if descendant:IsA("MeshPart") then
					descendant.RenderFidelity = Enum.RenderFidelity.Automatic
					descendant.CollisionFidelity = Enum.CollisionFidelity.Box
					paintHeroPart(descendant, record)
				end
			end
		end
		local center = hero:GetBoundingBox()
		hero.WorldPivot = CFrame.new(center.Position)
		hero:PivotTo(
			CFrame.new(toVector3(record.pivot))
				* CFrame.Angles(0, math.rad(record.yaw), 0)
				* CFrame.Angles(math.rad(record.roll or 0), 0, 0)
		)
		local count = (heroCountByKind[record.kind] or 0) + 1
		heroCountByKind[record.kind] = count
		hero.Name = `{record.kind}-hero-{count}`
		hero:SetAttribute(HERO_KIND_ATTRIBUTE_NAME, record.kind)
		if record.fallback then
			-- The set piece's seed offsets the sway phase, as it does for the ProceduralModel this mesh replaces.
			hero:SetAttribute("Seed", record.fallback.seed)
		end
		setIdleSway(hero, record.kind)
		hero.Parent = model
	end
	return failures
end

-- Turns off CastShadow on every part of each generated prop whose largest side is under noShadowSizeStuds.
local function clearSmallPropShadows(proceduralModels: { ProceduralModel })
	local limit = arguments.noShadowSizeStuds
	if not limit then
		error("A props phase needs noShadowSizeStuds.", 0)
	end
	for _, proceduralModel in proceduralModels do
		local size = proceduralModel.Size
		if math.max(size.X, size.Y, size.Z) >= limit then
			continue
		end
		for _, descendant in proceduralModel:GetDescendants() do
			if descendant:IsA("BasePart") then
				descendant.CastShadow = false
			end
		end
	end
end

-- Adds the set pieces, then the hero props; returns the hero assets that failed to load.
local function addPropModels(model: Model): { HeroLoadFailure }
	local generators = addGenerators(model)
	local countByKind: { [string]: number } = {}
	local proceduralModels: { ProceduralModel } = {}
	for _, record in arguments.props or ({} :: { PropRecord }) do
		table.insert(proceduralModels, addProp(model, generators, record, countByKind))
	end
	local failures = addHeroProps(model, generators, countByKind, proceduralModels)
	waitForGeneration(proceduralModels)
	clearSmallPropShadows(proceduralModels)
	if arguments.idleScript then
		local idleScript = Instance.new("Script")
		idleScript.Name = IDLE_SCRIPT_NAME
		idleScript.RunContext = Enum.RunContext.Server
		idleScript.Source = arguments.idleScript
		idleScript.Parent = model
	end
	return failures
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
	local terrainFills = arguments.terrainFills or ({} :: { TerrainFill })
	for _, fill in terrainFills do
		if fill.shape ~= "heightmap" then
			fillTerrain(fill, materialNamed(fill.material))
		end
	end
	model:SetAttribute(TERRAIN_ATTRIBUTE_NAME, HttpService:JSONEncode(terrainFills))
	applyTerrainOverrides()
	model.Parent = folder
	return oldModel ~= nil, countPartChildren(model)
end

-- Writes one chunk of a heightmap fill: full voxels up to the surface, a part-filled top voxel, the top voxel's material
-- from the column's surface layer and the base material below it.
local function writeTerrainChunk(chunk: TerrainChunk)
	local stud = chunk.voxelStuds
	local base = materialNamed(chunk.baseMaterial)
	local layers: { Enum.Material } = {}
	for _, name in chunk.layerMaterials do
		table.insert(layers, materialNamed(name))
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
	local minimum = toVector3(chunk.origin)
	local size = Vector3.new(chunk.columns, chunk.voxelsY, chunk.rows) * stud
	workspace.Terrain:WriteVoxels(Region3.new(minimum, minimum + size), stud, materials, occupancies)
end

-- Runs the phase named in the arguments; returns whether the shell replaced a map (nil for later phases), the Model's part
-- count and the hero assets the props phase failed to load.
local function addEffectAttachment(holder: BasePart, name: string, position: Vector): Attachment
	local attachment = Instance.new("Attachment")
	attachment.Name = name
	attachment.Parent = holder
	attachment.WorldPosition = toVector3(position)
	return attachment
end

local function addAmbientEffect(model: Model, record: AmbientEffectRecord)
	local holder = model:FindFirstChild(record.part)
	if not holder or not holder:IsA("BasePart") then
		error(`Ambient effect "{record.name}" of zone "{record.zone}" has no floor part named "{record.part}".`, 0)
	end
	local baseName = `{record.zone}-{record.name}-ambient`
	local color = ColorSequence.new(Color3.fromHex(record.color))
	local texture = record.texture or ""
	if record.kind == "beam" then
		local endPosition = record.endPosition
		if not endPosition or not record.widthStuds then
			error(`Ambient beam "{record.name}" needs endPosition and widthStuds.`, 0)
		end
		local beam = Instance.new("Beam")
		beam.Name = baseName
		beam.Attachment0 = addEffectAttachment(holder, `{baseName}-start`, record.position)
		beam.Attachment1 = addEffectAttachment(holder, `{baseName}-end`, endPosition)
		beam.Texture = texture
		beam.Color = color
		beam.Transparency = NumberSequence.new(record.transparency)
		beam.LightEmission = record.lightEmission
		beam.Width0 = record.widthStuds
		beam.Width1 = record.widthStuds
		beam.FaceCamera = true
		beam.Parent = holder
		return
	end
	if not record.rate or not record.lifetimeSeconds or not record.sizeStuds or not record.speedStuds then
		error(`Ambient particles "{record.name}" need rate, lifetimeSeconds, sizeStuds and speedStuds.`, 0)
	end
	local emitter = Instance.new("ParticleEmitter")
	emitter.Name = baseName
	emitter.Texture = texture
	emitter.Color = color
	emitter.Transparency = NumberSequence.new(record.transparency, 1)
	emitter.LightEmission = record.lightEmission
	emitter.Rate = record.rate
	emitter.Lifetime = NumberRange.new(record.lifetimeSeconds * 0.5, record.lifetimeSeconds)
	emitter.Size = NumberSequence.new(record.sizeStuds)
	emitter.Speed = NumberRange.new(record.speedStuds * 0.5, record.speedStuds)
	emitter.SpreadAngle = Vector2.new(180, 180)
	emitter.Parent = addEffectAttachment(holder, baseName, record.position)
end

local function addAmbientEffects(model: Model)
	for _, record in arguments.effects or ({} :: { AmbientEffectRecord }) do
		addAmbientEffect(model, record)
	end
end

local function runPhase(): (boolean?, number, { HeroLoadFailure }?)
	local phase = arguments.phase
	if phase == "shell" then
		return buildShell()
	end
	local failures: { HeroLoadFailure }? = nil
	local model = findModel()
	if phase == "floors and ceilings" or phase == "openings" or phase == "surfaces" then
		addParts(model)
	elseif phase == "props" then
		failures = addPropModels(model)
	elseif phase == "lighting" then
		addLights(model)
	elseif phase == "ambient effects" then
		addAmbientEffects(model)
	elseif phase == "terrain" then
		writeTerrainChunk(arguments.terrainChunk :: TerrainChunk)
	else
		error(`Unknown build phase "{phase}".`, 0)
	end
	return nil, countPartChildren(model), failures
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

local built, replacedOrError, partCount, heroLoadFailures = pcall(runPhase)
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

return HttpService:JSONEncode({
	partCount = partCount,
	replaced = replacedOrError,
	heroLoadFailures = heroLoadFailures,
})
