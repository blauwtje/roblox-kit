--!strict
-- ProceduralModel generator source for a control console: a desk with a button deck and a bank of screens behind it.
-- Params.Size is (length, height, depth); the operator side is -Z and the output stays inside Size.
-- The buttons pick the `light` or `screen` look per Seed so repeated consoles do not look stamped.
-- Colors and materials come from the `frame`, `panel`, `screen` and `light` slot, read as `<Slot>Color` and `<Slot>Material` attributes.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local DESK_HEIGHT_RATIO = 0.6
local DECK_HEIGHT = 0.15
local SCREEN_DEPTH = 0.3
local SCREEN_BANK_DEPTH_RATIO = 0.3
local BUTTON_SIZE = 0.35
local BUTTON_SPACING = 0.9
local BUTTON_ROW_COUNT = 2
local BUTTON_INSET = 0.6

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
	ScreenColor = DEFAULT_COLOR,
	ScreenMaterial = DEFAULT_MATERIAL,
	LightColor = DEFAULT_COLOR,
	LightMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local frame = slotLook(params.Attributes, "Frame")
	local panel = slotLook(params.Attributes, "Panel")
	local screen = slotLook(params.Attributes, "Screen")
	local light = slotLook(params.Attributes, "Light")
	local random = Random.new(params.Attributes.Seed)
	local buttonLooks = { light, screen }
	local bottom = -size.Y / 2
	local deskHeight = size.Y * DESK_HEIGHT_RATIO
	local deskDepth = size.Z * (1 - SCREEN_BANK_DEPTH_RATIO)
	local deskFrontZ = -size.Z / 2
	local bankHeight = size.Y - deskHeight
	local bankDepth = size.Z * SCREEN_BANK_DEPTH_RATIO

	addPart(
		targetContainer,
		"Desk",
		Vector3.new(size.X, deskHeight, deskDepth),
		Vector3.new(0, bottom + deskHeight / 2, deskFrontZ + deskDepth / 2),
		panel
	)
	addPart(
		targetContainer,
		"Deck",
		Vector3.new(size.X, DECK_HEIGHT, deskDepth),
		Vector3.new(0, bottom + deskHeight + DECK_HEIGHT / 2, deskFrontZ + deskDepth / 2),
		frame
	)
	addPart(
		targetContainer,
		"ScreenBank",
		Vector3.new(size.X, bankHeight, bankDepth),
		Vector3.new(0, bottom + deskHeight + bankHeight / 2, size.Z / 2 - bankDepth / 2),
		frame
	)
	addPart(
		targetContainer,
		"Screen",
		Vector3.new(size.X - BUTTON_INSET, bankHeight - BUTTON_INSET, SCREEN_DEPTH),
		Vector3.new(0, bottom + deskHeight + bankHeight / 2, size.Z / 2 - bankDepth - SCREEN_DEPTH / 2),
		screen
	)

	local buttonColumns = math.max(1, math.floor((size.X - BUTTON_INSET * 2) / BUTTON_SPACING))
	local rowSpacing = (deskDepth - BUTTON_INSET * 2) / BUTTON_ROW_COUNT
	local buttonY = bottom + deskHeight + DECK_HEIGHT + BUTTON_SIZE / 2
	for row = 1, BUTTON_ROW_COUNT do
		for column = 1, buttonColumns do
			addPart(
				targetContainer,
				"Button" .. row .. "_" .. column,
				Vector3.new(BUTTON_SIZE, BUTTON_SIZE, BUTTON_SIZE),
				Vector3.new(
					-size.X / 2 + BUTTON_INSET + (size.X - BUTTON_INSET * 2) * (column - 0.5) / buttonColumns,
					buttonY,
					deskFrontZ + BUTTON_INSET + rowSpacing * (row - 0.5)
				),
				buttonLooks[random:NextInteger(1, #buttonLooks)]
			)
		end
	end
	params:Pause()
end

return Generator
