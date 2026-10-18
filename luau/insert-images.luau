--!strict
-- Inserts planned images: screen labels and buttons into a ScreenGui, surface images into SurfaceGuis on named
-- part faces, flipbook particles into ParticleEmitters. Reads the plan from `arguments`; returns JSON of the
-- created instance paths.
type Slice = { center: { x0: number, y0: number, x1: number, y1: number }, sliceScale: number }

type Entry = {
	kind: string,
	name: string,
	image: string,
	parent: string,
	aspectRatio: number?,
	scale: { x: number, y: number }?,
	slice: Slice?,
	minPixels: number?,
	face: string?,
	layout: string?,
	framerate: number?,
}

type Arguments = {
	screenGui: { name: string, screenInsets: string },
	entries: { Entry },
}

local arguments: Arguments = ...
local HttpService = game:GetService("HttpService")
local StarterGui = game:GetService("StarterGui")

local function findPath(path: string): Instance
	local current: Instance = game
	for segment in string.gmatch(path, "[^%.]+") do
		local child = current:FindFirstChild(segment)
		if not child then
			error(`"{path}" has no "{segment}"; nothing was inserted for it.`, 0)
		end
		current = child
	end
	return current
end

local function pathOf(instance: Instance): string
	return (instance:GetFullName())
end

local screenGui: ScreenGui? = nil
local function getScreenGui(): ScreenGui
	if screenGui then
		return screenGui
	end
	local existing = StarterGui:FindFirstChild(arguments.screenGui.name)
	local gui = if existing and existing:IsA("ScreenGui") then existing else Instance.new("ScreenGui")
	gui.Name = arguments.screenGui.name
	gui.ScreenInsets = (Enum.ScreenInsets :: any)[arguments.screenGui.screenInsets]
	gui.ResetOnSpawn = false
	gui.Parent = StarterGui
	screenGui = gui
	return gui
end

local function replaceChild(parent: Instance, name: string)
	local old = parent:FindFirstChild(name)
	if old then
		old:Destroy()
	end
end

local function insertScreen(entry: Entry): Instance
	local gui = getScreenGui()
	replaceChild(gui, entry.name)
	local image: GuiObject
	if entry.kind == "button" then
		local button = Instance.new("ImageButton")
		button.Image = entry.image
		image = button
	else
		local label = Instance.new("ImageLabel")
		label.Image = entry.image
		image = label
	end
	if entry.slice then
		local center = entry.slice.center
		local sliced = image :: ImageLabel
		sliced.ScaleType = Enum.ScaleType.Slice
		sliced.SliceCenter = Rect.new(center.x0, center.y0, center.x1, center.y1)
		sliced.SliceScale = entry.slice.sliceScale
	end
	image.Name = entry.name
	image.BackgroundTransparency = 1
	local scale = entry.scale or { x = 0.2, y = 0.2 }
	image.Size = UDim2.fromScale(scale.x, scale.y)
	if entry.aspectRatio then
		local ratio = Instance.new("UIAspectRatioConstraint")
		ratio.AspectRatio = entry.aspectRatio
		ratio.Parent = image
	end
	if entry.minPixels then
		local size = Instance.new("UISizeConstraint")
		size.MinSize = Vector2.new(entry.minPixels, entry.minPixels)
		size.Parent = image
	end
	image.Parent = gui
	return image
end

local function insertSurface(entry: Entry): Instance
	local part = findPath(entry.parent)
	if not part:IsA("BasePart") then
		error(`"{entry.parent}" is not a part; a surface image needs one.`, 0)
	end
	replaceChild(part, entry.name)
	local surface = Instance.new("SurfaceGui")
	surface.Name = entry.name
	surface.Face = (Enum.NormalId :: any)[entry.face or "Front"]
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	local label = Instance.new("ImageLabel")
	label.Image = entry.image
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Parent = surface
	surface.Parent = part
	return surface
end

local function insertParticle(entry: Entry): Instance
	local parent = findPath(entry.parent)
	replaceChild(parent, entry.name)
	local emitter = Instance.new("ParticleEmitter")
	emitter.Name = entry.name
	emitter.Texture = entry.image
	emitter.FlipbookLayout = (Enum.ParticleFlipbookLayout :: any)[entry.layout or "Grid4x4"]
	emitter.FlipbookMode = Enum.ParticleFlipbookMode.Loop
	emitter.FlipbookFramerate = NumberRange.new(entry.framerate or 12)
	emitter.Parent = parent
	return emitter
end

local created: { string } = {}
for _, entry in arguments.entries do
	local instance
	if entry.kind == "surface" then
		instance = insertSurface(entry)
	elseif entry.kind == "particle" then
		instance = insertParticle(entry)
	else
		instance = insertScreen(entry)
	end
	table.insert(created, pathOf(instance))
end

return HttpService:JSONEncode({ created = created })
