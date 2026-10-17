--!strict
-- ProceduralModel generator source for a wall poster: a frame board with a printed panel on its -Z face.
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
	addPart(targetContainer, "Frame", Vector3.new(size.X, size.Y, size.Z / 2), Vector3.new(0, 0, size.Z / 4), frame)
	addPart(
		targetContainer,
		"Print",
		Vector3.new(size.X - 0.4, size.Y - 0.4, size.Z / 2),
		Vector3.new(0, 0, -size.Z / 4),
		panel
	)
	params:Pause()
end

return Generator
