--!strict
-- ProceduralModel generator source for a pillar: a base, a shaft and a capital.
-- Params.Size is (width, height, depth); the output is centered on the pivot and stays inside Size.
-- The shaft inset varies slightly per Seed so repeated pillars do not look stamped.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local BASE_HEIGHT_RATIO = 0.08
local CAPITAL_HEIGHT_RATIO = 0.08
local MINIMUM_SHAFT_WIDTH_RATIO = 0.7
local MAXIMUM_SHAFT_WIDTH_RATIO = 0.85

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
Generator.Attributes = { Seed = 0, SurfaceColor = DEFAULT_SURFACE_COLOR, SurfaceMaterial = DEFAULT_SURFACE_MATERIAL }

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local bottom = -size.Y / 2
	local baseHeight = size.Y * BASE_HEIGHT_RATIO
	local capitalHeight = size.Y * CAPITAL_HEIGHT_RATIO
	local shaftHeight = size.Y - baseHeight - capitalHeight
	local shaftRatio = random:NextNumber(MINIMUM_SHAFT_WIDTH_RATIO, MAXIMUM_SHAFT_WIDTH_RATIO)

	addPart(
		targetContainer,
		"Base",
		Vector3.new(size.X, baseHeight, size.Z),
		Vector3.new(0, bottom + baseHeight / 2, 0)
	)
	addPart(
		targetContainer,
		"Shaft",
		Vector3.new(size.X * shaftRatio, shaftHeight, size.Z * shaftRatio),
		Vector3.new(0, bottom + baseHeight + shaftHeight / 2, 0)
	)
	addPart(
		targetContainer,
		"Capital",
		Vector3.new(size.X, capitalHeight, size.Z),
		Vector3.new(0, bottom + baseHeight + shaftHeight + capitalHeight / 2, 0)
	)
	paintParts(targetContainer, params.Attributes)
	params:Pause()
end

return Generator
