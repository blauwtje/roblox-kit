--!strict
-- ProceduralModel generator source for a lamp post: a base, a pole and a head: a glowing bulb with a PointLight under a shade and cap.
-- Params.Size is (width, height, depth); the output is centered on the pivot and stays inside Size.
-- The head width varies slightly per Seed so repeated lamps do not look stamped.
-- Colors and materials come from the `frame` slot (base, pole, shade and cap), and the bulb from the `light` slot, read as `<Slot>Color` and
-- `<Slot>Material` attributes.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local BASE_HEIGHT_RATIO = 0.06
local HEAD_HEIGHT_RATIO = 0.14
local POLE_WIDTH_RATIO = 0.2
local MINIMUM_HEAD_WIDTH_RATIO = 0.8
-- The head's height splits into the bulb, the shade over it and the cap on top; the bulb is narrower than the shade.
local BULB_HEIGHT_RATIO = 0.6
local SHADE_HEIGHT_RATIO = 0.25
local BULB_WIDTH_RATIO = 0.7
local CAP_WIDTH_RATIO = 0.5

local propKit = require("../shared/prop-kit")
local slotLook = propKit.slotLook
local addPart = propKit.addPart

local DEFAULT_COLOR = propKit.DEFAULT_COLOR
local DEFAULT_MATERIAL = "Plastic"

local Generator = {}
Generator.Attributes = {
	Seed = 0,
	Brightness = 2,
	Range = 24,
	FrameColor = DEFAULT_COLOR,
	FrameMaterial = DEFAULT_MATERIAL,
	LightColor = DEFAULT_COLOR,
	LightMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local bottom = -size.Y / 2
	local frame = slotLook(params.Attributes, "Frame")
	local bulb = slotLook(params.Attributes, "Light")
	local baseHeight = size.Y * BASE_HEIGHT_RATIO
	local headHeight = size.Y * HEAD_HEIGHT_RATIO
	local poleHeight = size.Y - baseHeight - headHeight
	local poleWidth = math.min(size.X, size.Z) * POLE_WIDTH_RATIO
	local headWidth = size.X * random:NextNumber(MINIMUM_HEAD_WIDTH_RATIO, 1)
	local headDepth = size.Z * random:NextNumber(MINIMUM_HEAD_WIDTH_RATIO, 1)

	addPart(
		targetContainer,
		"Base",
		Vector3.new(size.X, baseHeight, size.Z),
		Vector3.new(0, bottom + baseHeight / 2, 0),
		frame
	)
	addPart(
		targetContainer,
		"Pole",
		Vector3.new(poleWidth, poleHeight, poleWidth),
		Vector3.new(0, bottom + baseHeight + poleHeight / 2, 0),
		frame
	)
	local headBottom = bottom + baseHeight + poleHeight
	local bulbHeight = headHeight * BULB_HEIGHT_RATIO
	local shadeHeight = headHeight * SHADE_HEIGHT_RATIO
	local capHeight = headHeight - bulbHeight - shadeHeight
	local head = addPart(
		targetContainer,
		"Head",
		Vector3.new(headWidth * BULB_WIDTH_RATIO, bulbHeight, headDepth * BULB_WIDTH_RATIO),
		Vector3.new(0, headBottom + bulbHeight / 2, 0),
		bulb
	)
	addPart(
		targetContainer,
		"Shade",
		Vector3.new(headWidth, shadeHeight, headDepth),
		Vector3.new(0, headBottom + bulbHeight + shadeHeight / 2, 0),
		frame
	)
	addPart(
		targetContainer,
		"Cap",
		Vector3.new(headWidth * CAP_WIDTH_RATIO, capHeight, headDepth * CAP_WIDTH_RATIO),
		Vector3.new(0, headBottom + bulbHeight + shadeHeight + capHeight / 2, 0),
		frame
	)

	local light = Instance.new("PointLight")
	light.Brightness = params.Attributes.Brightness
	light.Range = params.Attributes.Range
	light.Parent = head
	params:Pause()
end

return Generator
