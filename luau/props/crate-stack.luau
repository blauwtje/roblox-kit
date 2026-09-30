--!strict
-- ProceduralModel generator source for a crate stack: two wooden crates side by side with a third on top.
-- Params.Size is (length, height, depth); the stack stands on the bottom of Size and the output stays inside it.
-- Each crate is shifted, shrunk and darkened a little per Seed so repeated stacks do not look stamped.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local MAXIMUM_SHRINK_RATIO = 0.08
local BATTEN_THICKNESS = 0.15
local CRATE_COLOR = Color3.fromRGB(150, 112, 70)
local BATTEN_COLOR = Color3.fromRGB(96, 68, 40)
local MAXIMUM_DARKENING = 0.08

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

-- One crate with a batten across its front face, inside the box centered at `center` with `boxSize`.
local function addCrate(targetContainer: Instance, name: string, boxSize: Vector3, center: Vector3, random: Random)
	local shrink = 1 - random:NextNumber(0, MAXIMUM_SHRINK_RATIO)
	local crateSize = Vector3.new(boxSize.X * shrink, boxSize.Y * shrink, boxSize.Z * shrink - BATTEN_THICKNESS)
	local room = (boxSize - crateSize) / 2
	local crateCenter = Vector3.new(
		center.X + room.X * random:NextNumber(-1, 1),
		center.Y - room.Y,
		center.Z + BATTEN_THICKNESS / 2 + room.Z * random:NextNumber(-1, 1)
	)
	local darkening = random:NextNumber(0, MAXIMUM_DARKENING)
	addPart(
		targetContainer,
		name,
		crateSize,
		crateCenter,
		CRATE_COLOR:Lerp(Color3.new(0, 0, 0), darkening),
		Enum.Material.WoodPlanks
	)
	addPart(
		targetContainer,
		name .. "Batten",
		Vector3.new(crateSize.X, BATTEN_THICKNESS, BATTEN_THICKNESS),
		crateCenter + Vector3.new(0, 0, -crateSize.Z / 2 - BATTEN_THICKNESS / 2),
		BATTEN_COLOR,
		Enum.Material.Wood
	)
end

local Generator = {}
Generator.Attributes = { Seed = 0 }

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local crateSize = Vector3.new(size.X / 2, size.Y / 2, size.Z)
	local bottom = -size.Y / 2

	addCrate(targetContainer, "CrateLeft", crateSize, Vector3.new(-size.X / 4, bottom + crateSize.Y / 2, 0), random)
	addCrate(targetContainer, "CrateRight", crateSize, Vector3.new(size.X / 4, bottom + crateSize.Y / 2, 0), random)
	addCrate(
		targetContainer,
		"CrateTop",
		crateSize,
		Vector3.new(random:NextNumber(-size.X / 4, size.X / 4), bottom + crateSize.Y * 1.5, 0),
		random
	)
	params:Pause()
end

return Generator
