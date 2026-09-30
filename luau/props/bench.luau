--!strict
-- ProceduralModel generator source for a bench: a slatted seat on two side frames, plus a backrest.
-- Params.Size is (length, height, depth); the output is centered on the pivot and stays inside Size.
-- Slat thickness varies slightly per Seed so repeated benches do not look stamped.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local SEAT_HEIGHT_RATIO = 0.5
local SEAT_THICKNESS_RATIO = 0.12
local SLAT_GAP = 0.08
local FRAME_WIDTH = 0.3
local BACKREST_DEPTH = 0.2
local BACKREST_HEIGHT_RATIO = 0.4
local MINIMUM_SLAT_THICKNESS_RATIO = 0.85

local function addPart(targetContainer: Instance, name: string, size: Vector3, position: Vector3): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = false
	part.Size = size
	part.CFrame = CFrame.new(position)
	part.Parent = targetContainer
	return part
end

local Generator = {}
Generator.Attributes = { Seed = 0, Slats = 4 }

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local slatCount = math.max(1, math.floor(params.Attributes.Slats))
	local seatTop = -size.Y / 2 + size.Y * SEAT_HEIGHT_RATIO
	local seatThickness = size.Y * SEAT_THICKNESS_RATIO
	local usableDepth = size.Z - BACKREST_DEPTH
	local slatDepth = (usableDepth - SLAT_GAP * (slatCount - 1)) / slatCount
	local frontZ = -size.Z / 2

	for index = 1, slatCount do
		local thickness = seatThickness * random:NextNumber(MINIMUM_SLAT_THICKNESS_RATIO, 1)
		local centerZ = frontZ + (index - 0.5) * slatDepth + (index - 1) * SLAT_GAP
		addPart(
			targetContainer,
			"Slat" .. index,
			Vector3.new(size.X, thickness, slatDepth),
			Vector3.new(0, seatTop - thickness / 2, centerZ)
		)
	end

	local frameHeight = seatTop - seatThickness - (-size.Y / 2)
	for side = -1, 1, 2 do
		addPart(
			targetContainer,
			side < 0 and "FrameLeft" or "FrameRight",
			Vector3.new(FRAME_WIDTH, frameHeight, usableDepth),
			Vector3.new(side * (size.X / 2 - FRAME_WIDTH / 2), -size.Y / 2 + frameHeight / 2, frontZ + usableDepth / 2)
		)
	end

	local backrestHeight = size.Y * BACKREST_HEIGHT_RATIO
	addPart(
		targetContainer,
		"Backrest",
		Vector3.new(size.X, backrestHeight, BACKREST_DEPTH),
		Vector3.new(0, seatTop + backrestHeight / 2, size.Z / 2 - BACKREST_DEPTH / 2)
	)
	params:Pause()
end

return Generator
