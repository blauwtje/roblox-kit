--!strict
-- ProceduralModel generator source for a railing: evenly spaced posts under a top rail and a mid rail.
-- Params.Size is (length, height, thickness); the output is centered on the pivot and stays inside Size.
-- The post thickness varies slightly per Seed so repeated rails do not look stamped.
-- Colors and materials come from the `frame` slot, read as `<Slot>Color` and `<Slot>Material` attributes.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local RAIL_HEIGHT_RATIO = 0.08
local MID_RAIL_POSITION_RATIO = 0.5
local MINIMUM_POST_THICKNESS_RATIO = 0.7

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
	PostSpacing = 3,
	FrameColor = DEFAULT_COLOR,
	FrameMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local spans = math.max(1, math.ceil(size.X / params.Attributes.PostSpacing))
	local railHeight = size.Y * RAIL_HEIGHT_RATIO
	local postThickness = size.Z * random:NextNumber(MINIMUM_POST_THICKNESS_RATIO, 1)
	local postHeight = size.Y - railHeight
	local bottom = -size.Y / 2
	local frame = slotLook(params.Attributes, "Frame")

	for index = 0, spans do
		addPart(
			targetContainer,
			"Post" .. index,
			Vector3.new(postThickness, postHeight, postThickness),
			Vector3.new(-size.X / 2 + size.X * index / spans, bottom + postHeight / 2, 0),
			frame
		)
	end
	addPart(
		targetContainer,
		"TopRail",
		Vector3.new(size.X, railHeight, size.Z),
		Vector3.new(0, size.Y / 2 - railHeight / 2, 0),
		frame
	)
	addPart(
		targetContainer,
		"MidRail",
		Vector3.new(size.X, railHeight, postThickness),
		Vector3.new(0, bottom + postHeight * MID_RAIL_POSITION_RATIO, 0),
		frame
	)
	params:Pause()
end

return Generator
