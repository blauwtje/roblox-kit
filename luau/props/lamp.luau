--!strict
-- ProceduralModel generator source for a lamp post: a base, a pole and a head with a PointLight.
-- Params.Size is (width, height, depth); the output is centered on the pivot and stays inside Size.
-- The head width varies slightly per Seed so repeated lamps do not look stamped.
-- Colors and materials come from the `frame` slot, and the bulb from the `light` slot, read as `<Slot>Color` and
-- `<Slot>Material` attributes.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local BASE_HEIGHT_RATIO = 0.06
local HEAD_HEIGHT_RATIO = 0.14
local POLE_WIDTH_RATIO = 0.2
local MINIMUM_HEAD_WIDTH_RATIO = 0.8

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
	Brightness = 2,
	Range = 24,
	FrameColor = DEFAULT_COLOR,
	FrameMaterial = DEFAULT_MATERIAL,
	LightColor = DEFAULT_COLOR,
	LightMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local bottom = -size.Y / 2
	local frame = slotLook(params.Attributes, "Frame")
	local bulb = slotLook(params.Attributes, "Light")
	local baseHeight = size.Y * BASE_HEIGHT_RATIO
	local headHeight = size.Y * HEAD_HEIGHT_RATIO
	local poleHeight = size.Y - baseHeight - headHeight
	local poleWidth = math.min(size.X, size.Z) * POLE_WIDTH_RATIO
	local headWidth = size.X * random:NextNumber(MINIMUM_HEAD_WIDTH_RATIO, 1)
	local headDepth = size.Z * random:NextNumber(MINIMUM_HEAD_WIDTH_RATIO, 1)

	addPart(
		targetContainer,
		"Base",
		Vector3.new(size.X, baseHeight, size.Z),
		Vector3.new(0, bottom + baseHeight / 2, 0),
		frame
	)
	addPart(
		targetContainer,
		"Pole",
		Vector3.new(poleWidth, poleHeight, poleWidth),
		Vector3.new(0, bottom + baseHeight + poleHeight / 2, 0),
		frame
	)
	local head = addPart(
		targetContainer,
		"Head",
		Vector3.new(headWidth, headHeight, headDepth),
		Vector3.new(0, bottom + baseHeight + poleHeight + headHeight / 2, 0),
		bulb
	)

	local light = Instance.new("PointLight")
	light.Brightness = params.Attributes.Brightness
	light.Range = params.Attributes.Range
	light.Parent = head
	params:Pause()
end

return Generator
