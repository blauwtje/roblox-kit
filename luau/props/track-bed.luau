--!strict
-- ProceduralModel generator source for a railway track bed: a ballast bed with two steel rails on sleepers.
-- Params.Size is (length, height, width); the rails run along X and the output stays inside Size.
-- The sleeper spacing varies slightly per Seed so repeated track beds do not look stamped.
-- The ballast, sleepers and rails take the `panel`, `signage` and `frame` slots, read as `<Slot>Color` and
-- `<Slot>Material` attributes.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local BALLAST_HEIGHT_RATIO = 0.4
local SLEEPER_HEIGHT_RATIO = 0.2
local SLEEPER_LENGTH_RATIO = 0.8
local SLEEPER_THICKNESS = 0.6
local RAIL_HEIGHT_RATIO = 0.3
local RAIL_WIDTH = 0.25
local RAIL_GAUGE_RATIO = 0.5
local MINIMUM_SLEEPER_SPACING = 1.6
local MAXIMUM_SLEEPER_SPACING = 2.2

type Look = { Color: Color3, Material: Enum.Material }

local DEFAULT_COLOR = Instance.new("Part").Color
local DEFAULT_MATERIAL = "Plastic"

-- The color and material of a prop slot, named as in `Frame`: its `<Slot>Material` attribute holds an Enum.Material name.
local function slotLook(attributes: { [string]: any }, slot: string): Look
	local material = Enum.Material:FromName(attributes[`{slot}Material`]) :: Enum.Material
	return { Color = attributes[`{slot}Color`], Material = material }
end

local function addPart(targetContainer: Instance, name: string, size: Vector3, position: Vector3, look: Look): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = false
	part.Size = size
	part.Color = look.Color
	part.Material = look.Material
	part.CFrame = CFrame.new(position)
	part.Parent = targetContainer
	return part
end

local Generator = {}
Generator.Attributes = {
	Seed = 0,
	PanelColor = DEFAULT_COLOR,
	PanelMaterial = DEFAULT_MATERIAL,
	SignageColor = DEFAULT_COLOR,
	SignageMaterial = DEFAULT_MATERIAL,
	FrameColor = DEFAULT_COLOR,
	FrameMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local bottom = -size.Y / 2
	local ballast = slotLook(params.Attributes, "Panel")
	local sleeper = slotLook(params.Attributes, "Signage")
	local steel = slotLook(params.Attributes, "Frame")
	local ballastHeight = size.Y * BALLAST_HEIGHT_RATIO
	local sleeperHeight = size.Y * SLEEPER_HEIGHT_RATIO
	local railHeight = size.Y * RAIL_HEIGHT_RATIO
	local sleeperTop = bottom + ballastHeight + sleeperHeight
	local gauge = size.Z * RAIL_GAUGE_RATIO

	addPart(
		targetContainer,
		"Ballast",
		Vector3.new(size.X, ballastHeight, size.Z),
		Vector3.new(0, bottom + ballastHeight / 2, 0),
		ballast
	)

	local spacing = random:NextNumber(MINIMUM_SLEEPER_SPACING, MAXIMUM_SLEEPER_SPACING)
	local sleeperCount = math.max(1, math.floor((size.X - SLEEPER_THICKNESS) / spacing))
	for index = 0, sleeperCount do
		addPart(
			targetContainer,
			"Sleeper" .. index,
			Vector3.new(SLEEPER_THICKNESS, sleeperHeight, size.Z * SLEEPER_LENGTH_RATIO),
			Vector3.new(
				-size.X / 2 + SLEEPER_THICKNESS / 2 + (size.X - SLEEPER_THICKNESS) * index / sleeperCount,
				sleeperTop - sleeperHeight / 2,
				0
			),
			sleeper
		)
	end

	for side = -1, 1, 2 do
		addPart(
			targetContainer,
			side < 0 and "RailLeft" or "RailRight",
			Vector3.new(size.X, railHeight, RAIL_WIDTH),
			Vector3.new(0, sleeperTop + railHeight / 2, side * gauge / 2),
			steel
		)
	end
	params:Pause()
end

return Generator
