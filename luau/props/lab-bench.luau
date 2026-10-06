--!strict
-- ProceduralModel generator source for a laboratory bench: a steel cabinet under a dark worktop with glassware on top.
-- Params.Size is (length, height, depth); the user side is -Z and the output stays inside Size.
-- The number and height of the glass vessels vary per Seed so repeated benches do not look stamped.
-- Colors and materials come from the `frame`, `panel` and `glass` slot, read as `<Slot>Color` and `<Slot>Material` attributes.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local TOP_HEIGHT = 0.25
local TOP_OVERHANG = 0.2
local VESSEL_COUNT_MINIMUM = 2
local VESSEL_COUNT_MAXIMUM = 4
local VESSEL_WIDTH = 0.5
local VESSEL_HEIGHT_RATIO_MINIMUM = 0.15
local VESSEL_HEIGHT_RATIO_MAXIMUM = 0.3

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
	GlassColor = DEFAULT_COLOR,
	GlassMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local frame = slotLook(params.Attributes, "Frame")
	local panel = slotLook(params.Attributes, "Panel")
	local glass = slotLook(params.Attributes, "Glass")
	local random = Random.new(params.Attributes.Seed)
	local bottom = -size.Y / 2
	local cabinetHeight = size.Y - TOP_HEIGHT
	local usableWidth = size.X - VESSEL_WIDTH * 2

	addPart(
		targetContainer,
		"Cabinet",
		Vector3.new(size.X - TOP_OVERHANG * 2, cabinetHeight, size.Z - TOP_OVERHANG),
		Vector3.new(0, bottom + cabinetHeight / 2, TOP_OVERHANG / 2),
		panel
	)
	addPart(
		targetContainer,
		"Top",
		Vector3.new(size.X, TOP_HEIGHT, size.Z),
		Vector3.new(0, bottom + cabinetHeight + TOP_HEIGHT / 2, 0),
		frame
	)
	local vesselCount = random:NextInteger(VESSEL_COUNT_MINIMUM, VESSEL_COUNT_MAXIMUM)
	for index = 1, vesselCount do
		local vesselHeight = size.Y * random:NextNumber(VESSEL_HEIGHT_RATIO_MINIMUM, VESSEL_HEIGHT_RATIO_MAXIMUM)
		local vessel = addPart(
			targetContainer,
			"Vessel" .. index,
			Vector3.new(VESSEL_WIDTH, vesselHeight, VESSEL_WIDTH),
			Vector3.new(
				-usableWidth / 2 + usableWidth * (index - 0.5) / vesselCount,
				size.Y / 2 - vesselHeight / 2,
				random:NextNumber(-size.Z / 4, size.Z / 4)
			),
			glass
		)
		vessel.Transparency = 0.4
	end
	params:Pause()
end

return Generator
