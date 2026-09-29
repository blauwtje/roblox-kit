--!strict
-- ProceduralModel generator source for a service counter: a paneled body under an overhanging top.
-- Params.Size is (length, height, depth); the customer side is -Z and the output stays inside Size.
-- The top thickness varies slightly per Seed so repeated counters do not look stamped.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local MINIMUM_TOP_HEIGHT_RATIO = 0.08
local MAXIMUM_TOP_HEIGHT_RATIO = 0.12
local OVERHANG = 0.3
local KICK_HEIGHT_RATIO = 0.1
local KICK_INSET = 0.2
local BODY_COLOR = Color3.fromRGB(110, 78, 52)
local TOP_COLOR = Color3.fromRGB(196, 190, 178)
local KICK_COLOR = Color3.fromRGB(45, 40, 36)

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
	local bottom = -size.Y / 2
	local topHeight = size.Y * random:NextNumber(MINIMUM_TOP_HEIGHT_RATIO, MAXIMUM_TOP_HEIGHT_RATIO)
	local kickHeight = size.Y * KICK_HEIGHT_RATIO
	local bodyHeight = size.Y - topHeight - kickHeight
	local bodySize = Vector3.new(size.X - OVERHANG * 2, bodyHeight, size.Z - OVERHANG)

	addPart(
		targetContainer,
		"Kick",
		Vector3.new(bodySize.X - KICK_INSET * 2, kickHeight, bodySize.Z - KICK_INSET),
		Vector3.new(0, bottom + kickHeight / 2, OVERHANG / 2 + KICK_INSET / 2),
		KICK_COLOR,
		Enum.Material.SmoothPlastic
	)
	addPart(
		targetContainer,
		"Body",
		bodySize,
		Vector3.new(0, bottom + kickHeight + bodyHeight / 2, OVERHANG / 2),
		BODY_COLOR,
		Enum.Material.WoodPlanks
	)
	addPart(
		targetContainer,
		"Top",
		Vector3.new(size.X, topHeight, size.Z),
		Vector3.new(0, size.Y / 2 - topHeight / 2, 0),
		TOP_COLOR,
		Enum.Material.Marble
	)
	params:Pause()
end

return Generator
