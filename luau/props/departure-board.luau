--!strict
-- ProceduralModel generator source for a station departure board: a dark board on two posts, listing
-- departures in amber text under a DEPARTURES header.
-- Params.Size is (width, height, depth); the board shows the same list on its -Z and +Z faces, so it reads
-- from either side, and the output stays inside Size.
-- The times and platforms vary per Seed so repeated boards do not look stamped.
-- Colors and materials come from the `frame`, `signage`, `panel` and `screen` slots, read as `<Slot>Color` and
-- `<Slot>Material` attributes; a missing attribute leaves a new Part's own look.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local BOARD_HEIGHT_RATIO = 0.5
local BOARD_DEPTH_RATIO = 0.6
local CAP_HEIGHT = 0.3
local POST_WIDTH = 0.5
local POST_INSET = 0.6
local PIXELS_PER_STUD = 50
type Look = { Color: Color3, Material: Enum.Material }

local DEFAULT_COLOR = Instance.new("Part").Color
local DEFAULT_MATERIAL = "Plastic"

-- The color and material of a prop slot, named as in `Frame`: its `<Slot>Material` attribute holds an Enum.Material name.
local function slotLook(attributes: { [string]: any }, slot: string): Look
	local material = Enum.Material:FromName(attributes[`{slot}Material`]) :: Enum.Material
	return { Color = attributes[`{slot}Color`], Material = material }
end

local TEXT_FONT = Enum.Font.Code
local HEADER = "DEPARTURES"
local DESTINATIONS = { "CENTRAL", "HARBOUR", "NORTH PARK", "AIRPORT" }
local FIRST_HOUR = 8
local LAST_HOUR = 20
local PLATFORM_COUNT = 4

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

local function addRow(surface: SurfaceGui, order: number, text: string, color: Color3, rowCount: number)
	local row = Instance.new("TextLabel")
	row.Name = `Row{order}`
	row.LayoutOrder = order
	row.BackgroundTransparency = 1
	row.Size = UDim2.fromScale(1, 1 / rowCount)
	row.Font = TEXT_FONT
	row.Text = text
	row.TextColor3 = color
	row.TextScaled = true
	row.TextXAlignment = Enum.TextXAlignment.Left
	row.Parent = surface
end

-- One departure per destination, in time order: "08:15  CENTRAL     3".
local function departureRows(random: Random): { string }
	local rows = {}
	local minutes = FIRST_HOUR * 60 + random:NextInteger(0, 30)
	for _, destination in DESTINATIONS do
		minutes = math.min(minutes + random:NextInteger(5, 40), LAST_HOUR * 60)
		local time = string.format("%02d:%02d", minutes // 60, minutes % 60)
		local platform = random:NextInteger(1, PLATFORM_COUNT)
		table.insert(rows, string.format("%s  %-10s %d", time, destination, platform))
	end
	return rows
end

local function addBoardFace(board: Part, face: Enum.NormalId, rows: { string }, headerColor: Color3, textColor: Color3)
	local surface = Instance.new("SurfaceGui")
	surface.Name = `DepartureSurface{face.Name}`
	surface.Face = face
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = PIXELS_PER_STUD
	surface.CanvasSize = Vector2.new(board.Size.X * PIXELS_PER_STUD, board.Size.Y * PIXELS_PER_STUD)
	surface.Parent = board

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = surface

	local rowCount = #rows + 1
	addRow(surface, 0, HEADER, headerColor, rowCount)
	for index, text in rows do
		addRow(surface, index, text, textColor, rowCount)
	end
end

local Generator = {}
Generator.Attributes = {
	Seed = 0,
	FrameColor = DEFAULT_COLOR,
	FrameMaterial = DEFAULT_MATERIAL,
	SignageColor = DEFAULT_COLOR,
	SignageMaterial = DEFAULT_MATERIAL,
	PanelColor = DEFAULT_COLOR,
	PanelMaterial = DEFAULT_MATERIAL,
	ScreenColor = DEFAULT_COLOR,
	ScreenMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local frame = slotLook(params.Attributes, "Frame")
	local signage = slotLook(params.Attributes, "Signage")
	local panel = slotLook(params.Attributes, "Panel")
	local screenLook = slotLook(params.Attributes, "Screen")
	local bottom = -size.Y / 2
	local boardHeight = size.Y * BOARD_HEIGHT_RATIO - CAP_HEIGHT
	local postHeight = size.Y - boardHeight - CAP_HEIGHT
	local boardDepth = size.Z * BOARD_DEPTH_RATIO

	for _, side in { -1, 1 } do
		addPart(
			targetContainer,
			if side < 0 then "PostLeft" else "PostRight",
			Vector3.new(POST_WIDTH, postHeight, POST_WIDTH),
			Vector3.new(side * (size.X / 2 - POST_INSET), bottom + postHeight / 2, 0),
			frame
		)
	end
	local board = addPart(
		targetContainer,
		"Board",
		Vector3.new(size.X, boardHeight, boardDepth),
		Vector3.new(0, bottom + postHeight + boardHeight / 2, 0),
		signage
	)
	addPart(
		targetContainer,
		"Cap",
		Vector3.new(size.X, CAP_HEIGHT, size.Z),
		Vector3.new(0, size.Y / 2 - CAP_HEIGHT / 2, 0),
		frame
	)
	local rows = departureRows(random)
	addBoardFace(board, Enum.NormalId.Front, rows, panel.Color, screenLook.Color)
	addBoardFace(board, Enum.NormalId.Back, rows, panel.Color, screenLook.Color)
	params:Pause()
end

return Generator
