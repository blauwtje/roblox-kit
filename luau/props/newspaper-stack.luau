--!strict
-- ProceduralModel generator source for a stack of newspapers: a block of paper with a band.
-- Params.Size is the box the output stays inside, standing on its bottom.
-- Colors and materials come from the `frame` and `panel` slots, read as `<Slot>Color` and `<Slot>Material` attributes.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

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
	PanelColor = DEFAULT_COLOR,
	PanelMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local frame = slotLook(params.Attributes, "Frame")
	local panel = slotLook(params.Attributes, "Panel")
	local bottom = -size.Y / 2
	addPart(targetContainer, "Papers", size, Vector3.new(0, 0, 0), panel)
	addPart(
		targetContainer,
		"Band",
		Vector3.new(size.X * 0.6, 0.1, size.Z),
		Vector3.new(0, bottom + size.Y - 0.05, 0),
		frame
	)
	params:Pause()
end

return Generator
