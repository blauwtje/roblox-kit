--!strict
-- ProceduralModel generator source for a ticket office counter: a paneled counter under a glass screen that
-- metal posts split into numbered ticket windows, each with a pass-through slot, below a lit header band.
-- Params.Size is (length, height, depth); the customer side is -Z and the output stays inside Size.
-- The window count follows the length; the counter top thickness varies per Seed so repeated counters do not
-- look stamped.
-- Colors and materials come from the `frame`, `signage`, `panel`, `glass` and `screen` slots, read as `<Slot>Color` and
-- `<Slot>Material` attributes; a missing attribute leaves a new Part's own look.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local COUNTER_HEIGHT = 3.5
local MINIMUM_TOP_HEIGHT = 0.25
local MAXIMUM_TOP_HEIGHT = 0.4
local KICK_HEIGHT = 0.35
local HEADER_HEIGHT = 1.2
local GLASS_THICKNESS = 0.15
local POST_WIDTH = 0.3
local SLOT_HEIGHT = 0.5
local SLOT_WIDTH_RATIO = 0.4
local WINDOW_MIN_WIDTH = 4
local PIXELS_PER_STUD = 50
type Look = { Color: Color3, Material: Enum.Material }

local DEFAULT_COLOR = Instance.new("Part").Color
local DEFAULT_MATERIAL = "Plastic"

-- The color and material of a prop slot, named as in `Frame`: its `<Slot>Material` attribute holds an Enum.Material name.
local function slotLook(attributes: { [string]: any }, slot: string): Look
	local material = Enum.Material:FromName(attributes[`{slot}Material`]) :: Enum.Material
	return { Color = attributes[`{slot}Color`], Material = material }
end

local GLASS_TRANSPARENCY = 0.55
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

-- The window numbers on the header's customer face, one per window, evenly across its length.
local function addWindowNumbers(header: Part, windowCount: number, numberColor: Color3)
	local surface = Instance.new("SurfaceGui")
	surface.Name = "WindowNumbers"
	surface.Face = Enum.NormalId.Front
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = PIXELS_PER_STUD
	surface.CanvasSize = Vector2.new(header.Size.X * PIXELS_PER_STUD, header.Size.Y * PIXELS_PER_STUD)
	surface.Parent = header
	for window = 1, windowCount do
		local number = Instance.new("TextLabel")
		number.Name = `Window{window}`
		number.BackgroundTransparency = 1
		number.Position = UDim2.fromScale((window - 1) / windowCount, 0)
		number.Size = UDim2.fromScale(1 / windowCount, 1)
		number.Font = TEXT_FONT
		number.Text = tostring(window)
		number.TextColor3 = numberColor
		number.TextScaled = true
		number.Parent = surface
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
	GlassColor = DEFAULT_COLOR,
	GlassMaterial = DEFAULT_MATERIAL,
	ScreenColor = DEFAULT_COLOR,
	ScreenMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local frame = slotLook(params.Attributes, "Frame")
	local signage = slotLook(params.Attributes, "Signage")
	local panel = slotLook(params.Attributes, "Panel")
	local glass = slotLook(params.Attributes, "Glass")
	local screenLook = slotLook(params.Attributes, "Screen")
	local bottom = -size.Y / 2
	local counterHeight = math.min(COUNTER_HEIGHT, size.Y - HEADER_HEIGHT - SLOT_HEIGHT)
	local topHeight = random:NextNumber(MINIMUM_TOP_HEIGHT, MAXIMUM_TOP_HEIGHT)
	local bodyHeight = counterHeight - topHeight - KICK_HEIGHT
	local counterTop = bottom + counterHeight
	local screenHeight = size.Y - counterHeight - HEADER_HEIGHT
	-- The screen stands along the middle of the counter top, between customer and clerk.
	local screenZ = 0

	addPart(
		targetContainer,
		"Kick",
		Vector3.new(size.X, KICK_HEIGHT, size.Z * 0.8),
		Vector3.new(0, bottom + KICK_HEIGHT / 2, size.Z * 0.1),
		signage
	)
	addPart(
		targetContainer,
		"Body",
		Vector3.new(size.X, bodyHeight, size.Z * 0.9),
		Vector3.new(0, bottom + KICK_HEIGHT + bodyHeight / 2, size.Z * 0.05),
		frame
	)
	addPart(
		targetContainer,
		"Top",
		Vector3.new(size.X, topHeight, size.Z),
		Vector3.new(0, counterTop - topHeight / 2, 0),
		panel
	)

	local windowCount = math.max(1, math.floor(size.X / WINDOW_MIN_WIDTH))
	local windowWidth = size.X / windowCount
	-- Posts at both ends and between windows; each pane leaves a pass-through slot above the counter top.
	for post = 0, windowCount do
		local x = -size.X / 2 + post * windowWidth
		x = math.clamp(x, -size.X / 2 + POST_WIDTH / 2, size.X / 2 - POST_WIDTH / 2)
		addPart(
			targetContainer,
			`Post{post}`,
			Vector3.new(POST_WIDTH, screenHeight, POST_WIDTH),
			Vector3.new(x, counterTop + screenHeight / 2, screenZ),
			signage
		)
	end
	for window = 1, windowCount do
		local x = -size.X / 2 + (window - 0.5) * windowWidth
		local paneWidth = windowWidth - POST_WIDTH
		local slotWidth = paneWidth * SLOT_WIDTH_RATIO
		local sideWidth = (paneWidth - slotWidth) / 2
		local paneHeight = screenHeight - SLOT_HEIGHT
		local pane = addPart(
			targetContainer,
			`Pane{window}`,
			Vector3.new(paneWidth, paneHeight, GLASS_THICKNESS),
			Vector3.new(x, counterTop + SLOT_HEIGHT + paneHeight / 2, screenZ),
			glass
		)
		pane.Transparency = GLASS_TRANSPARENCY
		for _, side in { -1, 1 } do
			local sidePane = addPart(
				targetContainer,
				`Pane{window}{if side < 0 then "Left" else "Right"}`,
				Vector3.new(sideWidth, SLOT_HEIGHT, GLASS_THICKNESS),
				Vector3.new(x + side * (slotWidth / 2 + sideWidth / 2), counterTop + SLOT_HEIGHT / 2, screenZ),
				glass
			)
			sidePane.Transparency = GLASS_TRANSPARENCY
		end
	end
	local header = addPart(
		targetContainer,
		"Header",
		Vector3.new(size.X, HEADER_HEIGHT, size.Z * 0.4),
		Vector3.new(0, size.Y / 2 - HEADER_HEIGHT / 2, screenZ),
		signage
	)
	addWindowNumbers(header, windowCount, screenLook.Color)
	params:Pause()
end

return Generator
