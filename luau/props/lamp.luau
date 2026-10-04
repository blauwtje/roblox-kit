--!strict
-- ProceduralModel generator source for a lamp post: a base, a pole and a head with a PointLight.
-- Params.Size is (width, height, depth); the output is centered on the pivot and stays inside Size.
-- The head width varies slightly per Seed so repeated lamps do not look stamped.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local BASE_HEIGHT_RATIO = 0.06
local HEAD_HEIGHT_RATIO = 0.14
local POLE_WIDTH_RATIO = 0.2
local MINIMUM_HEAD_WIDTH_RATIO = 0.8

local function addPart(targetContainer: Instance, name: string, size: Vector3, position: Vector3): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = false
	part.Size = size
	part.CFrame = CFrame.new(position)
	part.Parent = targetContainer
	return part
end

local DEFAULT_SURFACE_COLOR = Color3.fromRGB(163, 162, 165)
local DEFAULT_SURFACE_MATERIAL = "Plastic"

-- Gives every part the preset surface role's color and material; the defaults are a new Part's own look.
local function paintParts(targetContainer: Instance, attributes: { [string]: any })
	local color: Color3 = attributes.SurfaceColor
	local material = Enum.Material:FromName(attributes.SurfaceMaterial) :: Enum.Material
	for _, child in targetContainer:GetChildren() do
		if child:IsA("BasePart") then
			child.Color = color
			child.Material = material
		end
	end
end

local Generator = {}
Generator.Attributes = {
	Seed = 0,
	Brightness = 2,
	Range = 24,
	SurfaceColor = DEFAULT_SURFACE_COLOR,
	SurfaceMaterial = DEFAULT_SURFACE_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local bottom = -size.Y / 2
	local baseHeight = size.Y * BASE_HEIGHT_RATIO
	local headHeight = size.Y * HEAD_HEIGHT_RATIO
	local poleHeight = size.Y - baseHeight - headHeight
	local poleWidth = math.min(size.X, size.Z) * POLE_WIDTH_RATIO
	local headWidth = size.X * random:NextNumber(MINIMUM_HEAD_WIDTH_RATIO, 1)
	local headDepth = size.Z * random:NextNumber(MINIMUM_HEAD_WIDTH_RATIO, 1)

	addPart(
		targetContainer,
		"Base",
		Vector3.new(size.X, baseHeight, size.Z),
		Vector3.new(0, bottom + baseHeight / 2, 0)
	)
	addPart(
		targetContainer,
		"Pole",
		Vector3.new(poleWidth, poleHeight, poleWidth),
		Vector3.new(0, bottom + baseHeight + poleHeight / 2, 0)
	)
	local head = addPart(
		targetContainer,
		"Head",
		Vector3.new(headWidth, headHeight, headDepth),
		Vector3.new(0, bottom + baseHeight + poleHeight + headHeight / 2, 0)
	)

	local light = Instance.new("PointLight")
	light.Brightness = params.Attributes.Brightness
	light.Range = params.Attributes.Range
	light.Parent = head
	paintParts(targetContainer, params.Attributes)
	params:Pause()
end

return Generator
