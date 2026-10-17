--!strict
-- Builds the Parts of a record list for the files of luau/build/ that add them (shell, parts, props); called with
-- the file's arguments and the prelude's helpers. Each part takes the MaterialVariant of its role when it has one.
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

type KitArguments = {
	mapId: string,
	ceilingTag: string?,
	-- Flat MaterialVariant of each surface role that has one.
	variants: { [string]: Variant }?,
}

local CollectionService = game:GetService("CollectionService")
local MaterialService = game:GetService("MaterialService")

return function(
	arguments: KitArguments,
	kit: { toVector3: (Vector) -> Vector3, materialNamed: (string) -> Enum.Material }
)
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
		materialVariant.BaseMaterial = kit.materialNamed(variant.baseMaterial)
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
		part.Size = kit.toVector3(record.size)
		part.Position = kit.toVector3(record.position)
		part.Material = kit.materialNamed(record.material)
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

	local function addParts(model: Model, records: { PartRecord }?)
		for _, record in records or ({} :: { PartRecord }) do
			newPart(record).Parent = model
		end
	end

	return {
		variantFor = variantFor,
		newPart = newPart,
		addParts = addParts,
	}
end
