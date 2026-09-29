--!strict
-- ProceduralModel generator source for a wall sign: a dark board with an accent frame and the Label as text.
-- Params.Size is (width, height, thickness); the text faces -Z and the output stays inside Size.
-- Label is the room type name and AccentColor the preset accent; an empty Label leaves the board blank.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local FRAME_WIDTH = 0.15
local FRAME_THICKNESS_RATIO = 0.4
local BOARD_COLOR = Color3.fromRGB(28, 30, 34)
local DEFAULT_ACCENT_COLOR = Color3.fromRGB(245, 205, 48)
local TEXT_FONT = Enum.Font.GothamBold

local function addPart(
	targetContainer: Instance,
	name: string,
	size: Vector3,
	position: Vector3,
	color: Color3,
	material: Enum.Material
): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = false
	part.Size = size
	part.Color = color
	part.Material = material
	part.CFrame = CFrame.new(position)
	part.Parent = targetContainer
	return part
end

local function addLabel(board: Part, text: string, color: Color3)
	local surface = Instance.new("SurfaceGui")
	surface.Name = "LabelSurface"
	surface.Face = Enum.NormalId.Front
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
Generator.Attributes = { Seed = 0, Label = "", AccentColor = DEFAULT_ACCENT_COLOR }

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local accent: Color3 = params.Attributes.AccentColor
	local label: string = params.Attributes.Label
	local frameThickness = size.Z * FRAME_THICKNESS_RATIO

	local board = addPart(targetContainer, "Board", size, Vector3.zero, BOARD_COLOR, Enum.Material.SmoothPlastic)
	local horizontalSize = Vector3.new(size.X, FRAME_WIDTH, frameThickness)
	local verticalSize = Vector3.new(FRAME_WIDTH, size.Y - FRAME_WIDTH * 2, frameThickness)
	local frontZ = -size.Z / 2 + frameThickness / 2
	addPart(
		targetContainer,
		"FrameTop",
		horizontalSize,
		Vector3.new(0, size.Y / 2 - FRAME_WIDTH / 2, frontZ),
		accent,
		Enum.Material.SmoothPlastic
	)
	addPart(
		targetContainer,
		"FrameBottom",
		horizontalSize,
		Vector3.new(0, -size.Y / 2 + FRAME_WIDTH / 2, frontZ),
		accent,
		Enum.Material.SmoothPlastic
	)
	addPart(
		targetContainer,
		"FrameLeft",
		verticalSize,
		Vector3.new(-size.X / 2 + FRAME_WIDTH / 2, 0, frontZ),
		accent,
		Enum.Material.SmoothPlastic
	)
	addPart(
		targetContainer,
		"FrameRight",
		verticalSize,
		Vector3.new(size.X / 2 - FRAME_WIDTH / 2, 0, frontZ),
		accent,
		Enum.Material.SmoothPlastic
	)
	if label ~= "" then
		addLabel(board, label, accent)
	end
	params:Pause()
end

return Generator
