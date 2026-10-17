--!strict
-- ProceduralModel generator source for a platform edge: a raised slab with a warning strip on its front edge.
-- Params.Size is (length, height, depth); the strip runs along the -Z edge, the side that faces the track.
-- The strip width varies slightly per Seed so repeated edges do not look stamped.
-- Colors and materials come from the `panel` and `frame` slots, read as `<Slot>Color` and
-- `<Slot>Material` attributes; a missing attribute leaves a new Part's own look.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local STRIP_HEIGHT = 0.1
local MINIMUM_STRIP_DEPTH_RATIO = 0.3
local MAXIMUM_STRIP_DEPTH_RATIO = 0.4
local propKit = require("../shared/prop-kit")
local slotLook = propKit.slotLook
local addPart = propKit.addPart

local DEFAULT_COLOR = propKit.DEFAULT_COLOR
local DEFAULT_MATERIAL = "Plastic"

local Generator = {}
Generator.Attributes = {
	Seed = 0,
	PanelColor = DEFAULT_COLOR,
	PanelMaterial = DEFAULT_MATERIAL,
	FrameColor = DEFAULT_COLOR,
	FrameMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local panel = slotLook(params.Attributes, "Panel")
	local frame = slotLook(params.Attributes, "Frame")
	local slabHeight = size.Y - STRIP_HEIGHT
	local stripDepth = size.Z * random:NextNumber(MINIMUM_STRIP_DEPTH_RATIO, MAXIMUM_STRIP_DEPTH_RATIO)

	addPart(
		targetContainer,
		"Slab",
		Vector3.new(size.X, slabHeight, size.Z),
		Vector3.new(0, -size.Y / 2 + slabHeight / 2, 0),
		panel
	)
	addPart(
		targetContainer,
		"WarningStrip",
		Vector3.new(size.X, STRIP_HEIGHT, stripDepth),
		Vector3.new(0, size.Y / 2 - STRIP_HEIGHT / 2, -size.Z / 2 + stripDepth / 2),
		frame
	)
	params:Pause()
end

return Generator
