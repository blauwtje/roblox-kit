--!strict
-- ProceduralModel generator source for a pillar: a base, a shaft and a capital.
-- Params.Size is (width, height, depth); the output is centered on the pivot and stays inside Size.
-- The shaft inset varies slightly per Seed so repeated pillars do not look stamped.
-- Colors and materials come from the `frame` slot, read as `<Slot>Color` and `<Slot>Material` attributes.
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
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local bottom = -size.Y / 2
	local frame = slotLook(params.Attributes, "Frame")
	local baseHeight = size.Y * BASE_HEIGHT_RATIO
	local capitalHeight = size.Y * CAPITAL_HEIGHT_RATIO
	local shaftHeight = size.Y - baseHeight - capitalHeight
	local shaftRatio = random:NextNumber(MINIMUM_SHAFT_WIDTH_RATIO, MAXIMUM_SHAFT_WIDTH_RATIO)

	addPart(
		targetContainer,
		"Base",
		Vector3.new(size.X, baseHeight, size.Z),
		Vector3.new(0, bottom + baseHeight / 2, 0),
		frame
	)
	addPart(
		targetContainer,
		"Shaft",
		Vector3.new(size.X * shaftRatio, shaftHeight, size.Z * shaftRatio),
		Vector3.new(0, bottom + baseHeight + shaftHeight / 2, 0),
		frame
	)
	addPart(
		targetContainer,
		"Capital",
		Vector3.new(size.X, capitalHeight, size.Z),
		Vector3.new(0, bottom + baseHeight + shaftHeight + capitalHeight / 2, 0),
		frame
	)
	params:Pause()
end

return Generator
