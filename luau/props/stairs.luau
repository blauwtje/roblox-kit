--!strict
-- ProceduralModel generator source for a straight stair that rises along +X.
-- Params.Size is (run, rise, width); the output is centered on the pivot and stays inside Size.
-- Each step is a block from the floor up to its tread, so the flight has no gaps underneath.
-- The tread nosing overhang is one value per Seed, so repeated stairs do not look stamped.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local MAXIMUM_NOSING_RATIO = 0.15

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

local Generator = {}
Generator.Attributes = { Seed = 0, Steps = 8 }

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local stepCount = math.max(1, math.floor(params.Attributes.Steps))
	local treadDepth = size.X / stepCount
	local riser = size.Y / stepCount
	local nosing = treadDepth * random:NextNumber(0, MAXIMUM_NOSING_RATIO)

	for index = 1, stepCount do
		local stepHeight = riser * index
		local depth = index == stepCount and treadDepth or treadDepth + nosing
		local frontX = -size.X / 2 + (index - 1) * treadDepth
		addPart(
			targetContainer,
			"Step" .. index,
			Vector3.new(depth, stepHeight, size.Z),
			Vector3.new(frontX + depth / 2, -size.Y / 2 + stepHeight / 2, 0)
		)
	end
	params:Pause()
end

return Generator
