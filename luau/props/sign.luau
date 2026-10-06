--!strict
-- ProceduralModel generator source for a hanging sign: a dark board with an accent frame and the Label as text.
-- Params.Size is (width, height, thickness); the text and frame are on both the -Z and +Z faces, so the sign
-- reads from either side, and the output stays inside Size.
-- Label is the room type name and AccentColor the preset accent; an empty Label leaves the board blank.
-- The board takes the `signage` slot's color and material, read as `SignageColor` and `SignageMaterial`; the frame
-- and text take AccentColor. A missing attribute leaves a new Part's own look.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local FRAME_WIDTH = 0.15
local FRAME_THICKNESS_RATIO = 0.4
type Look = { Color: Color3, Material: Enum.Material }

local DEFAULT_COLOR = Instance.new("Part").Color
local DEFAULT_MATERIAL = "Plastic"

-- The color and material of a prop slot, named as in `Frame`: its `<Slot>Material` attribute holds an Enum.Material name.
local function slotLook(attributes: { [string]: any }, slot: string): Look
	local material = Enum.Material:FromName(attributes[`{slot}Material`]) :: Enum.Material
	return { Color = attributes[`{slot}Color`], Material = material }
end

local TEXT_FONT = Enum.Font.GothamBold

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

local function addLabel(board: Part, face: Enum.NormalId, text: string, color: Color3)
	local surface = Instance.new("SurfaceGui")
	surface.Name = `LabelSurface{face.Name}`
	surface.Face = face
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = 50
	surface.CanvasSize = Vector2.new(board.Size.X * 50, board.Size.Y * 50)
	surface.Parent = board

	local label = Instance.new("TextLabel")
	label.Name = "Label"
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = TEXT_FONT
	label.Text = text
	label.TextColor3 = color
	label.TextScaled = true
	label.Parent = surface
end

local Generator = {}
Generator.Attributes = {
	Seed = 0,
	Label = "",
	AccentColor = DEFAULT_COLOR,
	SignageColor = DEFAULT_COLOR,
	SignageMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local signage = slotLook(params.Attributes, "Signage")
	local accent: Color3 = params.Attributes.AccentColor
	local label: string = params.Attributes.Label
	local frameLook: Look = { Color = accent, Material = signage.Material }
	local frameThickness = size.Z * FRAME_THICKNESS_RATIO

	local board = addPart(targetContainer, "Board", size, Vector3.zero, signage)
	local horizontalSize = Vector3.new(size.X, FRAME_WIDTH, frameThickness)
	local verticalSize = Vector3.new(FRAME_WIDTH, size.Y - FRAME_WIDTH * 2, frameThickness)
	for _, face in
		{
			{ name = "Front", z = -size.Z / 2 + frameThickness / 2 },
			{ name = "Back", z = size.Z / 2 - frameThickness / 2 },
		}
	do
		addPart(
			targetContainer,
			`Frame{face.name}Top`,
			horizontalSize,
			Vector3.new(0, size.Y / 2 - FRAME_WIDTH / 2, face.z),
			frameLook
		)
		addPart(
			targetContainer,
			`Frame{face.name}Bottom`,
			horizontalSize,
			Vector3.new(0, -size.Y / 2 + FRAME_WIDTH / 2, face.z),
			frameLook
		)
		addPart(
			targetContainer,
			`Frame{face.name}Left`,
			verticalSize,
			Vector3.new(-size.X / 2 + FRAME_WIDTH / 2, 0, face.z),
			frameLook
		)
		addPart(
			targetContainer,
			`Frame{face.name}Right`,
			verticalSize,
			Vector3.new(size.X / 2 - FRAME_WIDTH / 2, 0, face.z),
			frameLook
		)
	end
	if label ~= "" then
		addLabel(board, Enum.NormalId.Front, label, accent)
		addLabel(board, Enum.NormalId.Back, label, accent)
	end
	params:Pause()
end

return Generator
