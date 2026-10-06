--!strict
-- ProceduralModel generator source for a ticket vending machine: a tall cabinet with a lit touch screen, a
-- keypad, a card reader and a ticket slot on its -Z face, under a lit header.
-- Params.Size is (width, height, depth); the customer side is -Z and the output stays inside Size.
-- Colors and materials come from the `frame`, `panel`, `signage`, `screen` and `light` slots, read as
-- `<Slot>Color` and `<Slot>Material` attributes; a missing attribute leaves a new Part's own look.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local PLINTH_HEIGHT = 0.3
local PLINTH_INSET = 0.1
local HEADER_HEIGHT = 0.9
local FACE_THICKNESS = 0.1
local SIDE_MARGIN = 0.3
local SCREEN_HEIGHT_RATIO = 0.3
local SCREEN_WIDTH_RATIO = 0.8
local SCREEN_CENTER_RATIO = 0.62
local KEYPAD_HEIGHT = 0.9
local KEYPAD_CENTER_RATIO = 0.4
local KEY_COLUMNS = 3
local KEY_ROWS = 3
local KEY_GAP = 0.1
local KEY_THICKNESS = 0.08
local READER_HEIGHT = 0.4
local READER_CENTER_RATIO = 0.27
local SLOT_HEIGHT = 0.3
local SLOT_CENTER_RATIO = 0.15

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
	SignageColor = DEFAULT_COLOR,
	SignageMaterial = DEFAULT_MATERIAL,
	ScreenColor = DEFAULT_COLOR,
	ScreenMaterial = DEFAULT_MATERIAL,
	LightColor = DEFAULT_COLOR,
	LightMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local frame = slotLook(params.Attributes, "Frame")
	local panel = slotLook(params.Attributes, "Panel")
	local signage = slotLook(params.Attributes, "Signage")
	local screenLook = slotLook(params.Attributes, "Screen")
	local light = slotLook(params.Attributes, "Light")
	local bottom = -size.Y / 2
	local bodyHeight = size.Y - PLINTH_HEIGHT
	local bodyBottom = bottom + PLINTH_HEIGHT
	-- The customer face is a layer of keys and panels in front of the body; both stay inside Size.
	local faceDepth = FACE_THICKNESS + KEY_THICKNESS
	local bodyDepth = size.Z - faceDepth
	local bodyZ = faceDepth / 2
	local faceZ = -size.Z / 2 + KEY_THICKNESS + FACE_THICKNESS / 2
	local faceWidth = size.X - 2 * SIDE_MARGIN

	addPart(
		targetContainer,
		"Plinth",
		Vector3.new(size.X - 2 * PLINTH_INSET, PLINTH_HEIGHT, size.Z - 2 * PLINTH_INSET),
		Vector3.new(0, bottom + PLINTH_HEIGHT / 2, 0),
		signage
	)
	addPart(
		targetContainer,
		"Body",
		Vector3.new(size.X, bodyHeight - HEADER_HEIGHT, bodyDepth),
		Vector3.new(0, bodyBottom + (bodyHeight - HEADER_HEIGHT) / 2, bodyZ),
		frame
	)
	addPart(
		targetContainer,
		"Header",
		Vector3.new(size.X, HEADER_HEIGHT, bodyDepth),
		Vector3.new(0, size.Y / 2 - HEADER_HEIGHT / 2, bodyZ),
		light
	)

	local screenHeight = bodyHeight * SCREEN_HEIGHT_RATIO
	local screen = addPart(
		targetContainer,
		"Screen",
		Vector3.new(faceWidth * SCREEN_WIDTH_RATIO, screenHeight, FACE_THICKNESS),
		Vector3.new(0, bodyBottom + bodyHeight * SCREEN_CENTER_RATIO, faceZ),
		screenLook
	)
	screen.Reflectance = 0.1

	local keypadWidth = faceWidth * SCREEN_WIDTH_RATIO
	local keypadCenter = Vector3.new(0, bodyBottom + bodyHeight * KEYPAD_CENTER_RATIO, faceZ)
	addPart(targetContainer, "Keypad", Vector3.new(keypadWidth, KEYPAD_HEIGHT, FACE_THICKNESS), keypadCenter, panel)
	local keyWidth = (keypadWidth - (KEY_COLUMNS + 1) * KEY_GAP) / KEY_COLUMNS
	local keyHeight = (KEYPAD_HEIGHT - (KEY_ROWS + 1) * KEY_GAP) / KEY_ROWS
	for row = 1, KEY_ROWS do
		for column = 1, KEY_COLUMNS do
			local x = -keypadWidth / 2 + KEY_GAP + (column - 0.5) * keyWidth + (column - 1) * KEY_GAP
			local y = KEYPAD_HEIGHT / 2 - KEY_GAP - (row - 0.5) * keyHeight - (row - 1) * KEY_GAP
			addPart(
				targetContainer,
				`Key{row}{column}`,
				Vector3.new(keyWidth, keyHeight, KEY_THICKNESS),
				Vector3.new(keypadCenter.X + x, keypadCenter.Y + y, -size.Z / 2 + KEY_THICKNESS / 2),
				signage
			)
		end
	end

	addPart(
		targetContainer,
		"CardReader",
		Vector3.new(faceWidth * 0.5, READER_HEIGHT, FACE_THICKNESS),
		Vector3.new(0, bodyBottom + bodyHeight * READER_CENTER_RATIO, faceZ),
		panel
	)
	addPart(
		targetContainer,
		"TicketSlot",
		Vector3.new(faceWidth * 0.6, SLOT_HEIGHT, FACE_THICKNESS),
		Vector3.new(0, bodyBottom + bodyHeight * SLOT_CENTER_RATIO, faceZ),
		signage
	)
	params:Pause()
end

return Generator
