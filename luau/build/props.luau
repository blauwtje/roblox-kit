--!strict
-- The props phase of build_map. Each prop becomes a ProceduralModel running the ModuleScript of its kind under the
-- Model, generated before the phase returns. Each hero prop is its uploaded asset loaded with InsertService into a
-- Model named "<kind>-hero-<n>", scaled to its size, centered on its pivot and turned by its yaw, its MeshParts
-- colored from the surface each is named after, anchored and decorative; an asset that fails to load builds the set
-- piece it replaced and is reported in `heroLoadFailures`. A prop kind listed in `idleAnimations` gets the sway
-- attributes on each of its ProceduralModels, and the phase then adds one client Script holding `idleScript` under
-- the Model, which sways them during play. Reports the number of parts in the Model after the phase (the BaseParts
-- that are children of the Model).
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
	-- A declared mesh's kit parts (a doorway arch's jambs and lintel), all built when the asset fails to load.
	fallbackParts: { PartRecord }?,
	-- A pendant mesh's tag: every part carries it, so capture_zones' cutaway hides the mesh with the ceilings.
	ceilingTag: string?,
	-- Degrees about the mesh's own x axis, applied after the yaw: 180 turns a cornice over, -90 stands a jamb up.
	roll: number?,
	-- Studs of bevel of each surface role's mesh; the smallest of its shapes, 0 for a shape with none. Absent: no bevel rule.
	bevels: { [string]: number }?,
	-- "stretch" (a prop kind's mesh) scales the asset to `size` on each axis, not evenly to `size.x`;
	-- "none" (a declared mesh) keeps its modelled size.
	fit: string?,
	-- With fit "none": whether `pivot` is the mesh's "bottom" centre or its box "center" (the default).
	anchor: string?,
	-- The one MeshPart of the asset to keep; the others are removed. Absent keeps them all.
	part: string?,
}

type Variant = {
	baseMaterial: string,
	studsPerTile: number,
	maps: { color: string, normal: string, roughness: string, metalness: string }?,
	materialPattern: string?,
}

type HeroLoadFailure = { kind: string, assetId: string, error: string }

-- How one prop kind sways during play; see luau/idle-animation.luau.
type IdleAnimation = {
	swayDegrees: number,
	periodSeconds: number,
	hinge: string,
}

type Arguments = {
	phase: string,
	mapId: string,
	mapsFolderName: string,
	props: { PropRecord }?,
	-- Source text of the generator of each prop kind.
	generators: { [string]: string }?,
	heroProps: { HeroPropRecord }?,
	ceilingTag: string?,
	variants: { [string]: Variant }?,
	-- A prop whose largest side is under this casts no shadow.
	noShadowSizeStuds: number?,
	-- The idle sway of each animated prop kind, and the client Script source that runs it.
	idleAnimations: { [string]: IdleAnimation }?,
	idleScript: string?,
}

-- Attribute naming a hero Model's kind; check-map.luau finds hero Models by it.
local HERO_KIND_ATTRIBUTE_NAME = "RobloxKitHeroKind"
-- Attribute on a hero MeshPart holding its bevel in studs; read-props.luau reports it.
local BEVEL_ATTRIBUTE_NAME = "RobloxKitBevel"
-- Name of the client Script that runs the idle sway; idle-animation.luau reads the three attributes below.
local IDLE_SCRIPT_NAME = "RobloxKitIdleAnimation"

local arguments: Arguments = ...
local CollectionService = game:GetService("CollectionService")
local InsertService = game:GetService("InsertService")
local buildPrelude = require("./prelude")
local kit = buildPrelude(arguments)
local buildPartKit = require("./part-kit")
local partKit = buildPartKit(arguments, kit)

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
	proceduralModel.Size = kit.toVector3(record.size)
	proceduralModel:SetAttribute("Seed", record.seed)
	for name, value in record.attributes or ({} :: { [string]: string }) do
		proceduralModel:SetAttribute(name, if string.match(name, "Color$") then Color3.fromHex(value) else value)
	end
	setIdleSway(proceduralModel, record.kind)
	local turn = CFrame.Angles(0, math.rad(record.yaw or 0), 0)
	proceduralModel:PivotTo(CFrame.new(kit.toVector3(record.pivot)) * turn)
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
	part.Material = kit.materialNamed(surface.material)
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
				partKit.newPart(record.fallbackPart).Parent = model
			elseif record.fallbackParts then
				for _, part in record.fallbackParts do
					partKit.newPart(part).Parent = model
				end
			end
			continue
		end
		local hero = heroOrError :: Model
		if record.part then
			local kept = false
			for _, descendant in hero:GetDescendants() do
				if descendant:IsA("MeshPart") then
					if descendant.Name == record.part then
						kept = true
					else
						descendant:Destroy()
					end
				end
			end
			if not kept then
				error(`Hero prop {record.kind} (asset {record.assetId}) has no MeshPart named "{record.part}".`, 0)
			end
		end
		local _, extents = hero:GetBoundingBox()
		if extents.X <= 0 then
			error(`Hero prop {record.kind} (asset {record.assetId}) has no width to scale.`, 0)
		end
		if record.fit == "stretch" then
			stretchHero(hero, extents, record)
		elseif record.fit ~= "none" then
			hero:ScaleTo(hero:GetScale() * record.size.x / extents.X)
		end
		for _, descendant in hero:GetDescendants() do
			if descendant:IsA("BasePart") then
				descendant.Anchored = true
				descendant.CanCollide = false
				descendant.CanTouch = false
				descendant.CanQuery = false
				if record.ceilingTag then
					CollectionService:AddTag(descendant, record.ceilingTag)
				end
				if descendant:IsA("MeshPart") then
					descendant.RenderFidelity = Enum.RenderFidelity.Automatic
					descendant.CollisionFidelity = Enum.CollisionFidelity.Box
					-- A declared mesh names no surfaces: its baked SurfaceAppearance is its look.
					if next(record.surfaces) ~= nil then
						paintHeroPart(descendant, record)
					end
				end
			end
		end
		local center, size = hero:GetBoundingBox()
		hero.WorldPivot = CFrame.new(center.Position)
		-- A bottom anchor stands the mesh on the pivot: its box center is half its height above.
		local lift = if record.anchor == "bottom" then Vector3.new(0, size.Y / 2, 0) else Vector3.zero
		hero:PivotTo(
			CFrame.new(kit.toVector3(record.pivot) + lift)
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
		idleScript.RunContext = Enum.RunContext.Client
		idleScript.Source = arguments.idleScript
		idleScript.Parent = model
	end
	return failures
end

return kit.run(function()
	local model = kit.findModel()
	local failures = addPropModels(model)
	return nil, kit.countPartChildren(model), failures
end)
