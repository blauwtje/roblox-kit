--!strict
-- ProceduralModel generator source for a platform edge: a raised slab with a yellow warning strip on its front edge.
-- Params.Size is (length, height, depth); the strip runs along the -Z edge, the side that faces the track.
-- The strip width varies slightly per Seed so repeated edges do not look stamped.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local STRIP_HEIGHT = 0.1
local MINIMUM_STRIP_DEPTH_RATIO = 0.3
local MAXIMUM_STRIP_DEPTH_RATIO = 0.4
local SLAB_COLOR = Color3.fromRGB(170, 168, 162)
local STRIP_COLOR = Color3.fromRGB(245, 205, 48)

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
	local slabHeight = size.Y - STRIP_HEIGHT
	local stripDepth = size.Z * random:NextNumber(MINIMUM_STRIP_DEPTH_RATIO, MAXIMUM_STRIP_DEPTH_RATIO)

	addPart(
		targetContainer,
		"Slab",
		Vector3.new(size.X, slabHeight, size.Z),
		Vector3.new(0, -size.Y / 2 + slabHeight / 2, 0),
		SLAB_COLOR,
		Enum.Material.Concrete
	)
	addPart(
		targetContainer,
		"WarningStrip",
		Vector3.new(size.X, STRIP_HEIGHT, stripDepth),
		Vector3.new(0, size.Y / 2 - STRIP_HEIGHT / 2, -size.Z / 2 + stripDepth / 2),
		STRIP_COLOR,
		Enum.Material.SmoothPlastic
	)
	params:Pause()
end

return Generator
