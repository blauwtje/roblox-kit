--!strict
-- ProceduralModel generator source for a platform edge: a raised slab with a warning strip on its front edge.
-- Params.Size is (length, height, depth); the strip runs along the -Z edge, the side that faces the track.
-- The strip width varies slightly per Seed so repeated edges do not look stamped.
-- Colors and materials come from the `panel` and `frame` slots, read as `<Slot>Color` and
-- `<Slot>Material` attributes; a missing attribute leaves a new Part's own look.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local STRIP_HEIGHT = 0.1
local MINIMUM_STRIP_DEPTH_RATIO = 0.3
local MAXIMUM_STRIP_DEPTH_RATIO = 0.4
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
	PanelColor = DEFAULT_COLOR,
	PanelMaterial = DEFAULT_MATERIAL,
	FrameColor = DEFAULT_COLOR,
	FrameMaterial = DEFAULT_MATERIAL,
}

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local panel = slotLook(params.Attributes, "Panel")
	local frame = slotLook(params.Attributes, "Frame")
	local slabHeight = size.Y - STRIP_HEIGHT
	local stripDepth = size.Z * random:NextNumber(MINIMUM_STRIP_DEPTH_RATIO, MAXIMUM_STRIP_DEPTH_RATIO)

	addPart(
		targetContainer,
		"Slab",
		Vector3.new(size.X, slabHeight, size.Z),
		Vector3.new(0, -size.Y / 2 + slabHeight / 2, 0),
		panel
	)
	addPart(
		targetContainer,
		"WarningStrip",
		Vector3.new(size.X, STRIP_HEIGHT, stripDepth),
		Vector3.new(0, size.Y / 2 - STRIP_HEIGHT / 2, -size.Z / 2 + stripDepth / 2),
		frame
	)
	params:Pause()
end

return Generator
