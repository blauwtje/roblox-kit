--!strict
-- ProceduralModel generator source for a period queue barrier: evenly spaced turned posts (a foot plate, a shaft and a
-- ball cap) joined by a round top rail and a round mid rail.
-- Params.Size is (length, height, thickness); the output is centered on the pivot and stays inside Size.
-- The post thickness varies slightly per Seed so repeated rails do not look stamped.
-- Colors and materials come from the `frame` slot, read as `<Slot>Color` and `<Slot>Material` attributes.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local RAIL_DIAMETER_RATIO = 0.06
local MID_RAIL_POSITION_RATIO = 0.5
local MINIMUM_POST_THICKNESS_RATIO = 0.7
local FOOT_HEIGHT_RATIO = 0.04
local SHAFT_WIDTH_RATIO = 0.5
local CAP_WIDTH_RATIO = 0.75
local TOP_RAIL_DROP_RATIO = 1.2

type Look = { Color: Color3, Material: Enum.Material }

local propKit = require("../shared/prop-kit")
local slotLook = propKit.slotLook
local addPart = propKit.addPart

local DEFAULT_COLOR = propKit.DEFAULT_COLOR
local DEFAULT_MATERIAL = "Plastic"

-- A cylinder standing on its end: a Cylinder part's axis is X, so it is turned a quarter about Z.
local function addUprightCylinder(
	targetContainer: Instance,
	name: string,
	diameter: number,
	height: number,
	position: Vector3,
	look: Look
): Part
	return addPart(
		targetContainer,
		name,
		Vector3.new(height, diameter, diameter),
		position,
		look,
		Enum.PartType.Cylinder,
		CFrame.new(position) * CFrame.Angles(0, 0, math.pi / 2)
	)
end

local Generator = {}
Generator.Attributes = {
	Seed = 0,
	PostSpacing = 3,
	FrameColor = DEFAULT_COLOR,
	FrameMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local spans = math.max(1, math.ceil(size.X / params.Attributes.PostSpacing))
	local postThickness = size.Z * random:NextNumber(MINIMUM_POST_THICKNESS_RATIO, 1)
	local footHeight = size.Y * FOOT_HEIGHT_RATIO
	local shaftWidth = postThickness * SHAFT_WIDTH_RATIO
	local capWidth = postThickness * CAP_WIDTH_RATIO
	local railDiameter = math.min(size.Y * RAIL_DIAMETER_RATIO, shaftWidth)
	local bottom = -size.Y / 2
	local top = size.Y / 2
	local frame = slotLook(params.Attributes, "Frame")
	local firstPostX = -size.X / 2 + postThickness / 2
	local postRun = size.X - postThickness

	for index = 0, spans do
		local x = firstPostX + postRun * index / spans
		addUprightCylinder(
			targetContainer,
			"Foot" .. index,
			postThickness,
			footHeight,
			Vector3.new(x, bottom + footHeight / 2, 0),
			frame
		)
		addUprightCylinder(
			targetContainer,
			"Post" .. index,
			shaftWidth,
			size.Y - capWidth,
			Vector3.new(x, bottom + (size.Y - capWidth) / 2, 0),
			frame
		)
		addPart(
			targetContainer,
			"Cap" .. index,
			Vector3.new(capWidth, capWidth, capWidth),
			Vector3.new(x, top - capWidth / 2, 0),
			frame,
			Enum.PartType.Ball
		)
	end
	local railHeights = {
		TopRail = top - capWidth * TOP_RAIL_DROP_RATIO,
		MidRail = bottom + size.Y * MID_RAIL_POSITION_RATIO,
	}
	for _, name in { "TopRail", "MidRail" } do
		addPart(
			targetContainer,
			name,
			Vector3.new(postRun, railDiameter, railDiameter),
			Vector3.new(0, railHeights[name], 0),
			frame,
			Enum.PartType.Cylinder
		)
	end
	params:Pause()
end

return Generator
