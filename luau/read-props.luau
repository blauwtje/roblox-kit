--!strict
-- Reads one built map: each ProceduralModel under the map Model, named "<kind>-<n>", with the size it
-- was generated at, its pivot position, its yaw in degrees and whether its up axis is still the world's;
-- each Part under the map Model with whether it shows a texture; each light with where it stands; and each
-- MeshPart of a hero Model with the bevel attribute build-map.luau set on it.
-- Returns a compact JSON object, so execute_luau does not cut it.
type Arguments = {
	mapId: string,
	mapsFolderName: string,
}

type Prop = {
	path: string,
	kind: string,
	size: { x: number, y: number, z: number },
	position: { x: number, y: number, z: number },
	yaw: number,
	upright: boolean,
}

type Surface = {
	path: string,
	size: { x: number, y: number, z: number },
	position: { x: number, y: number, z: number },
	textured: boolean,
}

type LightRecord = {
	path: string,
	position: { x: number, y: number, z: number },
}

type HeroPart = {
	path: string,
	kind: string,
	position: { x: number, y: number, z: number },
	bevel: number,
}

-- An up axis whose Y component is under this is tilted: cos(0.5 degrees), the tolerance of the 90-degree grid.
local UPRIGHT_MINIMUM_UP_Y = 0.99996
local DECIMALS = 100
-- Names build-map.luau gives: the attribute on a hero Model naming its kind, and on a hero MeshPart its bevel in studs.
local HERO_KIND_ATTRIBUTE_NAME = "RobloxKitHeroKind"
local BEVEL_ATTRIBUTE_NAME = "RobloxKitBevel"
-- Materials with no texture of their own; every other material draws one.
local PLAIN_MATERIALS: { [Enum.Material]: boolean } = {
	[Enum.Material.Plastic] = true,
	[Enum.Material.SmoothPlastic] = true,
	[Enum.Material.Neon] = true,
	[Enum.Material.Glass] = true,
	[Enum.Material.ForceField] = true,
}

local arguments: Arguments = ...
local HttpService = game:GetService("HttpService")

local function findMapModel(): Model
	local folder = workspace:FindFirstChild(arguments.mapsFolderName)
	local model = if folder then folder:FindFirstChild(arguments.mapId) else nil
	if model == nil or not model:IsA("Model") then
		error(
			`No map "{arguments.mapId}" under Workspace.{arguments.mapsFolderName}. Call build_map with this mapId first, or use the mapId it returned.`,
			0
		)
	end
	return model
end

local function rounded(value: number): number
	return math.round(value * DECIMALS) / DECIMALS
end

local function toVector(vector: Vector3): { x: number, y: number, z: number }
	return { x = rounded(vector.X), y = rounded(vector.Y), z = rounded(vector.Z) }
end

-- The kind is the name before its trailing "-<n>".
local function kindOf(name: string): string
	return string.match(name, "^(.+)%-%d+$") or name
end

-- Turn about Y of the model's forward axis, which is 0 when it faces -Z as an unturned model does.
local function yawOf(pivot: CFrame): number
	local forward = pivot.LookVector
	return rounded(math.deg(math.atan2(-forward.X, -forward.Z)))
end

local function isTextured(part: BasePart): boolean
	if part:FindFirstChildWhichIsA("SurfaceAppearance") or part:FindFirstChildWhichIsA("Texture") then
		return true
	end
	if part:FindFirstChildWhichIsA("Decal") or part.MaterialVariant ~= "" then
		return true
	end
	return not PLAIN_MATERIALS[part.Material]
end

-- Where a light stands: its Attachment's or its part's position; a light under anything else has none.
local function lightPosition(light: Light): Vector3?
	local holder = light.Parent
	if holder and holder:IsA("Attachment") then
		return holder.WorldPosition
	end
	if holder and holder:IsA("BasePart") then
		return holder.Position
	end
	return nil
end

local mapModel = findMapModel()
local props: { Prop } = {}
local surfaces: { Surface } = {}
local lights: { LightRecord } = {}
local heroParts: { HeroPart } = {}
for _, child in mapModel:GetChildren() do
	if child:IsA("Part") and child.Transparency < 1 then
		table.insert(surfaces, {
			path = child:GetFullName(),
			size = toVector(child.Size),
			position = toVector(child.Position),
			textured = isTextured(child),
		})
	end
	local heroKind = child:GetAttribute(HERO_KIND_ATTRIBUTE_NAME)
	if child:IsA("Model") and typeof(heroKind) == "string" then
		for _, descendant in child:GetDescendants() do
			-- A mesh built without the attribute (a trim profile) has no bevel rule.
			local bevel = descendant:GetAttribute(BEVEL_ATTRIBUTE_NAME)
			if descendant:IsA("MeshPart") and typeof(bevel) == "number" then
				table.insert(heroParts, {
					path = descendant:GetFullName(),
					kind = heroKind,
					position = toVector(descendant.Position),
					bevel = bevel,
				})
			end
		end
	end
	if child:IsA("ProceduralModel") then
		local pivot = child:GetPivot()
		table.insert(props, {
			path = child:GetFullName(),
			kind = kindOf(child.Name),
			size = toVector(child.Size),
			position = toVector(pivot.Position),
			yaw = yawOf(pivot),
			upright = pivot.UpVector.Y >= UPRIGHT_MINIMUM_UP_Y,
		})
	end
end
for _, descendant in mapModel:GetDescendants() do
	local position = if descendant:IsA("Light") then lightPosition(descendant) else nil
	if position then
		table.insert(lights, { path = descendant:GetFullName(), position = toVector(position) })
	end
end

return HttpService:JSONEncode({ props = props, surfaces = surfaces, lights = lights, heroParts = heroParts })
