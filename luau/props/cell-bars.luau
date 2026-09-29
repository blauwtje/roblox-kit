--!strict
-- ProceduralModel generator source for a row of prison cell bars: vertical steel bars between a top and a bottom rail.
-- Params.Size is (width, height, thickness); the bars stand along Y and the output stays inside Size.
-- Bar spacing varies slightly per Seed so repeated cells do not look stamped.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local RAIL_HEIGHT = 0.4
local BAR_THICKNESS = 0.25
local MINIMUM_BAR_SPACING = 0.7
local MAXIMUM_BAR_SPACING = 0.9
local BAR_COLOR = Color3.fromRGB(58, 60, 64)
local RAIL_COLOR = Color3.fromRGB(40, 42, 46)

local function addPart(
	targetContainer: Instance,
	name: string,
	size: Vector3,
	position: Vector3,
	color: Color3,
	material: Enum.Material
): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = false
	part.Size = size
	part.Color = color
	part.Material = material
	part.CFrame = CFrame.new(position)
	part.Parent = targetContainer
	return part
end

local Generator = {}
Generator.Attributes = { Seed = 0 }

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local barHeight = size.Y - RAIL_HEIGHT * 2
	local railSize = Vector3.new(size.X, RAIL_HEIGHT, size.Z)

	addPart(
		targetContainer,
		"RailBottom",
		railSize,
		Vector3.new(0, -size.Y / 2 + RAIL_HEIGHT / 2, 0),
		RAIL_COLOR,
		Enum.Material.Metal
	)
	addPart(
		targetContainer,
		"RailTop",
		railSize,
		Vector3.new(0, size.Y / 2 - RAIL_HEIGHT / 2, 0),
		RAIL_COLOR,
		Enum.Material.Metal
	)
	local spacing = random:NextNumber(MINIMUM_BAR_SPACING, MAXIMUM_BAR_SPACING)
	local barCount = math.max(2, math.floor((size.X - BAR_THICKNESS) / spacing) + 1)
	local barStep = (size.X - BAR_THICKNESS) / (barCount - 1)
	for index = 1, barCount do
		addPart(
			targetContainer,
			"Bar" .. index,
			Vector3.new(BAR_THICKNESS, barHeight, BAR_THICKNESS),
			Vector3.new(-size.X / 2 + BAR_THICKNESS / 2 + barStep * (index - 1), 0, 0),
			BAR_COLOR,
			Enum.Material.Metal
		)
	end
	params:Pause()
end

return Generator
