--!strict
-- ProceduralModel generator source for a fireplace: a brick surround with a mantel shelf and a burning hearth.
-- Params.Size is (width, height, depth); the opening faces -Z and the output stays inside Size.
-- The flame height varies per Seed so repeated fireplaces do not look stamped.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local MANTEL_HEIGHT = 0.3
local MANTEL_OVERHANG = 0.3
local OPENING_WIDTH_RATIO = 0.5
local OPENING_HEIGHT_RATIO = 0.5
local HEARTH_HEIGHT = 0.2
local BACK_THICKNESS = 0.3
local MINIMUM_FLAME_HEIGHT_RATIO = 0.6
local MAXIMUM_FLAME_HEIGHT_RATIO = 0.9
local BRICK_COLOR = Color3.fromRGB(150, 74, 56)
local MANTEL_COLOR = Color3.fromRGB(96, 68, 40)
local OPENING_COLOR = Color3.fromRGB(20, 16, 14)
local HEARTH_COLOR = Color3.fromRGB(88, 86, 84)
local FLAME_COLOR = Color3.fromRGB(255, 140, 40)

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
	local bodyHeight = size.Y - MANTEL_HEIGHT
	local openingSize = Vector3.new(size.X * OPENING_WIDTH_RATIO, bodyHeight * OPENING_HEIGHT_RATIO, size.Z)
	local frontZ = -size.Z / 2
	local flameHeight = openingSize.Y * random:NextNumber(MINIMUM_FLAME_HEIGHT_RATIO, MAXIMUM_FLAME_HEIGHT_RATIO)

	local sideWidth = (size.X - MANTEL_OVERHANG * 2 - openingSize.X) / 2
	local sideSize = Vector3.new(sideWidth, bodyHeight, size.Z)
	local sideOffset = openingSize.X / 2 + sideWidth / 2
	local lintelHeight = bodyHeight - HEARTH_HEIGHT - openingSize.Y
	addPart(
		targetContainer,
		"SurroundLeft",
		sideSize,
		Vector3.new(-sideOffset, bottom + bodyHeight / 2, 0),
		BRICK_COLOR,
		Enum.Material.Brick
	)
	addPart(
		targetContainer,
		"SurroundRight",
		sideSize,
		Vector3.new(sideOffset, bottom + bodyHeight / 2, 0),
		BRICK_COLOR,
		Enum.Material.Brick
	)
	addPart(
		targetContainer,
		"Lintel",
		Vector3.new(openingSize.X, lintelHeight, size.Z),
		Vector3.new(0, bottom + bodyHeight - lintelHeight / 2, 0),
		BRICK_COLOR,
		Enum.Material.Brick
	)
	addPart(
		targetContainer,
		"Mantel",
		Vector3.new(size.X, MANTEL_HEIGHT, size.Z),
		Vector3.new(0, size.Y / 2 - MANTEL_HEIGHT / 2, 0),
		MANTEL_COLOR,
		Enum.Material.Wood
	)
	addPart(
		targetContainer,
		"Firebox",
		Vector3.new(openingSize.X, openingSize.Y, BACK_THICKNESS),
		Vector3.new(0, bottom + HEARTH_HEIGHT + openingSize.Y / 2, size.Z / 2 - BACK_THICKNESS / 2),
		OPENING_COLOR,
		Enum.Material.SmoothPlastic
	)
	addPart(
		targetContainer,
		"Hearth",
		Vector3.new(openingSize.X, HEARTH_HEIGHT, size.Z * 0.4),
		Vector3.new(0, bottom + HEARTH_HEIGHT / 2, frontZ + size.Z * 0.2),
		HEARTH_COLOR,
		Enum.Material.Slate
	)
	addPart(
		targetContainer,
		"Flame",
		Vector3.new(openingSize.X * 0.6, flameHeight, size.Z * 0.3),
		Vector3.new(0, bottom + HEARTH_HEIGHT + flameHeight / 2, frontZ + size.Z * 0.6),
		FLAME_COLOR,
		Enum.Material.Neon
	)
	params:Pause()
end

return Generator
