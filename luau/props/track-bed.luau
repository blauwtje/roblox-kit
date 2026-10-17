--!strict
-- ProceduralModel generator source for a railway track bed: a ballast bed with two steel rails on sleepers.
-- Params.Size is (length, height, width); the rails run along X, 5.7 studs apart (narrower when the bed is), with
-- their tops at the top of Size, so a car stood on the bed's top rests on them; the output stays inside Size.
-- The sleeper spacing varies slightly per Seed so repeated track beds do not look stamped.
-- The rails take the `frame` slot, the sleepers the `sleeper` slot and the ballast the `ballast` slot, each read as
-- `<Slot>Color` and `<Slot>Material` attributes. The sleepers have their own slot rather than `seat`, the bench's
-- dark wood and so the rails' own color, or `signage`, which is navy.
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
local RAIL_HEIGHT_RATIO = 0.4
local RAIL_WIDTH = 0.25
-- The station train car's wheel gauge, center to center, so its wheels stand on the rails.
local RAIL_GAUGE = 5.7
local MINIMUM_SLEEPER_SPACING = 1.6
local MAXIMUM_SLEEPER_SPACING = 2.2

local propKit = require("../shared/prop-kit")
local slotLook = propKit.slotLook
local addPart = propKit.addPart

local DEFAULT_COLOR = propKit.DEFAULT_COLOR
local DEFAULT_MATERIAL = "Plastic"

local Generator = {}
Generator.Attributes = {
	Seed = 0,
	FrameColor = DEFAULT_COLOR,
	FrameMaterial = DEFAULT_MATERIAL,
	SleeperColor = DEFAULT_COLOR,
	SleeperMaterial = DEFAULT_MATERIAL,
	BallastColor = DEFAULT_COLOR,
	BallastMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local bottom = -size.Y / 2
	local sleeper = slotLook(params.Attributes, "Sleeper")
	local steel = slotLook(params.Attributes, "Frame")
	local ballast = slotLook(params.Attributes, "Ballast")
	local ballastHeight = size.Y * BALLAST_HEIGHT_RATIO
	local sleeperHeight = size.Y * SLEEPER_HEIGHT_RATIO
	local railHeight = size.Y * RAIL_HEIGHT_RATIO
	local sleeperTop = bottom + ballastHeight + sleeperHeight
	local gauge = math.min(RAIL_GAUGE, size.Z - RAIL_WIDTH)

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
