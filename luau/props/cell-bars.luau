--!strict
-- ProceduralModel generator source for a row of prison cell bars: vertical steel bars between a top and a bottom rail.
-- Params.Size is (width, height, thickness); the bars stand along Y and the output stays inside Size.
-- Bar spacing varies slightly per Seed so repeated cells do not look stamped.
-- Colors and materials come from the `frame` and `panel` slot, read as `<Slot>Color` and `<Slot>Material` attributes.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local RAIL_HEIGHT = 0.4
local BAR_THICKNESS = 0.25
local MINIMUM_BAR_SPACING = 0.7
local MAXIMUM_BAR_SPACING = 0.9

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
	FrameColor = DEFAULT_COLOR,
	FrameMaterial = DEFAULT_MATERIAL,
	PanelColor = DEFAULT_COLOR,
	PanelMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local frame = slotLook(params.Attributes, "Frame")
	local panel = slotLook(params.Attributes, "Panel")
	local random = Random.new(params.Attributes.Seed)
	local barHeight = size.Y - RAIL_HEIGHT * 2
	local railSize = Vector3.new(size.X, RAIL_HEIGHT, size.Z)

	addPart(targetContainer, "RailBottom", railSize, Vector3.new(0, -size.Y / 2 + RAIL_HEIGHT / 2, 0), panel)
	addPart(targetContainer, "RailTop", railSize, Vector3.new(0, size.Y / 2 - RAIL_HEIGHT / 2, 0), panel)
	local spacing = random:NextNumber(MINIMUM_BAR_SPACING, MAXIMUM_BAR_SPACING)
	local barCount = math.max(2, math.floor((size.X - BAR_THICKNESS) / spacing) + 1)
	local barStep = (size.X - BAR_THICKNESS) / (barCount - 1)
	for index = 1, barCount do
		addPart(
			targetContainer,
			"Bar" .. index,
			Vector3.new(BAR_THICKNESS, barHeight, BAR_THICKNESS),
			Vector3.new(-size.X / 2 + BAR_THICKNESS / 2 + barStep * (index - 1), 0, 0),
			frame
		)
	end
	params:Pause()
end

return Generator
