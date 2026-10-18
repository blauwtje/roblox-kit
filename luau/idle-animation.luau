--!strict
-- Client Script (RunContext Client) that build_map places under a map Model when its style animates prop kinds.
-- Every descendant Model of the map with an `IdleSwayDegrees` attribute sways about a hinge at the top or bottom
-- of its box (`IdleHinge`), around its own X axis, with a sine of period `IdlePeriodSeconds` plus a little
-- noise on both axes; its `Seed` attribute offsets the phase so neighbors do not swing in step. Each angle is
-- taken from the pivot the Model had when the Script started, so the sway never drifts. Only models within
-- GATE_DISTANCE studs of the camera move, and all of them move in one BulkMoveTo per frame.
-- A Model with a `MotionKind` attribute of `tick`, `flicker` or `flip` (with `MotionPeriodSeconds` and
-- `MotionAmplitude`) does that motion instead of swaying: `tick` steps its `SecondHand*` parts by the amplitude in
-- degrees each period, `flicker` dims its lights by up to the amplitude (0 to 1), and `flip` swaps the text of
-- `amplitude` neighbouring pairs of `Rows` TextLabels (`Row1`, `Row2`, ...) each period. Only text rows change;
-- the header row and anything that is not a TextLabel stay as built.
local RunService = game:GetService("RunService")

-- Share of the sway that comes from noise rather than the sine, and how fast the noise wanders.
local NOISE_SHARE = 0.35
local NOISE_SPEED = 0.4

-- Studs from the camera beyond which a model holds still.
local GATE_DISTANCE = 150

type Swaying = {
	model: Model,
	rest: CFrame,
	hingeOffset: CFrame,
	hingeInverse: CFrame,
	parts: { BasePart },
	partOffsets: { CFrame },
	amplitude: number,
	angularSpeed: number,
	phase: number,
}

local map = script.Parent
assert(map, "The idle animation Script needs its map Model as parent.")

local function swayingOf(model: Model): Swaying?
	local motionKind = model:GetAttribute("MotionKind")
	if motionKind ~= nil and motionKind ~= "sway" then
		return nil
	end
	local swayDegrees = model:GetAttribute("IdleSwayDegrees")
	local periodSeconds = model:GetAttribute("IdlePeriodSeconds")
	if type(swayDegrees) ~= "number" or type(periodSeconds) ~= "number" or periodSeconds <= 0 then
		return nil
	end
	local _, size = model:GetBoundingBox()
	local direction = if model:GetAttribute("IdleHinge") == "bottom" then -1 else 1
	local seed = model:GetAttribute("Seed")
	local rest = model:GetPivot()
	local parts: { BasePart } = {}
	local partOffsets: { CFrame } = {}
	for _, descendant in model:GetDescendants() do
		if descendant:IsA("BasePart") then
			table.insert(parts, descendant)
			table.insert(partOffsets, rest:ToObjectSpace(descendant.CFrame))
		end
	end
	local hingeOffset = CFrame.new(0, direction * size.Y / 2, 0)
	return {
		model = model,
		rest = rest,
		hingeOffset = hingeOffset,
		hingeInverse = hingeOffset:Inverse(),
		parts = parts,
		partOffsets = partOffsets,
		amplitude = math.rad(swayDegrees),
		angularSpeed = 2 * math.pi / periodSeconds,
		phase = if type(seed) == "number" then (seed % 1000) / 1000 * 2 * math.pi else 0,
	}
end

type Hand = { part: BasePart, rest: CFrame, half: CFrame, halfInverse: CFrame, turn: number }
type Timed = { model: Model, rest: Vector3, period: number, amplitude: number, phase: number, step: number }
type Ticking = Timed & { hands: { Hand } }
type Flickering = Timed & { lights: { Light }, brightness: { number } }
type Flipping = Timed & { boards: { { TextLabel } } }

local function timedOf(model: Model, kind: string): Timed?
	local period = model:GetAttribute("MotionPeriodSeconds")
	local amplitude = model:GetAttribute("MotionAmplitude")
	if model:GetAttribute("MotionKind") ~= kind or type(period) ~= "number" or period <= 0 then
		return nil
	end
	if type(amplitude) ~= "number" then
		return nil
	end
	local seed = model:GetAttribute("Seed")
	return {
		model = model,
		rest = model:GetPivot().Position,
		period = period,
		amplitude = amplitude,
		phase = if type(seed) == "number" then (seed % 1000) / 1000 * 2 * math.pi else 0,
		step = -1,
	}
end

-- Hands are named SecondHandFront (facing -Z) and SecondHandBack (facing +Z); each is a bar whose end is the dial
-- centre, so it turns about that end around its own Z axis, the way clock.luau turns the other hands.
local function tickingOf(model: Model): Ticking?
	local timed = timedOf(model, "tick")
	if not timed then
		return nil
	end
	local hands: { Hand } = {}
	for _, descendant in model:GetDescendants() do
		if descendant:IsA("BasePart") and string.match(descendant.Name, "^SecondHand") then
			local facing = if string.find(descendant.Name, "Front", 1, true) then -1 else 1
			local half = CFrame.new(0, -descendant.Size.Y / 2, 0)
			table.insert(hands, {
				part = descendant,
				rest = descendant.CFrame,
				half = half,
				halfInverse = half:Inverse(),
				turn = -facing,
			})
		end
	end
	if #hands == 0 then
		return nil
	end
	local ticking = timed :: Ticking
	ticking.hands = hands
	return ticking
end

local function flickeringOf(model: Model): Flickering?
	local timed = timedOf(model, "flicker")
	if not timed then
		return nil
	end
	local lights: { Light } = {}
	local brightness: { number } = {}
	for _, descendant in model:GetDescendants() do
		if descendant:IsA("Light") then
			table.insert(lights, descendant)
			table.insert(brightness, descendant.Brightness)
		end
	end
	if #lights == 0 then
		return nil
	end
	local flickering = timed :: Flickering
	flickering.lights = lights
	flickering.brightness = brightness
	return flickering
end

-- The TextLabels named Row1, Row2, ... under each SurfaceGui, in row order. Row0 is the header and is left alone,
-- as is any child that is not a TextLabel.
local function flippingOf(model: Model): Flipping?
	local timed = timedOf(model, "flip")
	if not timed then
		return nil
	end
	local boards: { { TextLabel } } = {}
	for _, descendant in model:GetDescendants() do
		if not descendant:IsA("SurfaceGui") then
			continue
		end
		local rows: { TextLabel } = {}
		for _, child in descendant:GetChildren() do
			if child:IsA("TextLabel") and string.match(child.Name, "^Row%d+$") and child.LayoutOrder >= 1 then
				table.insert(rows, child)
			end
		end
		table.sort(rows, function(a: TextLabel, b: TextLabel)
			return a.LayoutOrder < b.LayoutOrder
		end)
		if #rows >= 2 then
			table.insert(boards, rows)
		end
	end
	if #boards == 0 then
		return nil
	end
	local flipping = timed :: Flipping
	flipping.boards = boards
	return flipping
end

local swaying: { Swaying } = {}
local ticking: { Ticking } = {}
local flickering: { Flickering } = {}
local flipping: { Flipping } = {}
for _, descendant in map:GetDescendants() do
	if not descendant:IsA("Model") then
		continue
	end
	local sway = swayingOf(descendant)
	if sway then
		table.insert(swaying, sway)
	end
	local tick = tickingOf(descendant)
	if tick then
		table.insert(ticking, tick)
	end
	local flicker = flickeringOf(descendant)
	if flicker then
		table.insert(flickering, flicker)
	end
	local flip = flippingOf(descendant)
	if flip then
		table.insert(flipping, flip)
	end
end

local function near(entry: Timed, cameraPosition: Vector3): boolean
	return entry.model.Parent ~= nil and (entry.rest - cameraPosition).Magnitude <= GATE_DISTANCE
end

-- Each period the second hands jump `amplitude` degrees on from where they were built.
local function runTicks(elapsed: number, cameraPosition: Vector3)
	local moveParts: { BasePart } = {}
	local moveCFrames: { CFrame } = {}
	for _, entry in ticking do
		local step = math.floor(elapsed / entry.period)
		if step == entry.step or not near(entry, cameraPosition) then
			continue
		end
		entry.step = step
		local angle = math.rad(entry.amplitude * step)
		for _, hand in entry.hands do
			table.insert(moveParts, hand.part)
			table.insert(moveCFrames, hand.rest * hand.half * CFrame.Angles(0, 0, hand.turn * angle) * hand.halfInverse)
		end
	end
	if #moveParts > 0 then
		workspace:BulkMoveTo(moveParts, moveCFrames)
	end
end

local function runFlickers(elapsed: number, cameraPosition: Vector3)
	for _, entry in flickering do
		if not near(entry, cameraPosition) then
			continue
		end
		local dip = math.clamp(math.abs(math.noise(elapsed / entry.period, entry.phase)) * 2, 0, 1)
		local scale = 1 - entry.amplitude * dip
		for index, light in entry.lights do
			light.Brightness = entry.brightness[index] * scale
		end
	end
end

-- Each period `amplitude` pairs of neighbouring rows swap text, walking down the board a pair further each time.
local function runFlips(elapsed: number, cameraPosition: Vector3)
	for _, entry in flipping do
		local step = math.floor(elapsed / entry.period)
		if step == entry.step or not near(entry, cameraPosition) then
			continue
		end
		entry.step = step
		for _, rows in entry.boards do
			local swaps = math.max(1, math.floor(entry.amplitude))
			for swap = 0, swaps - 1 do
				local first = (step * swaps + swap) % (#rows - 1) + 1
				local upper, lower = rows[first], rows[first + 1]
				if upper and lower then
					upper.Text, lower.Text = lower.Text, upper.Text
				end
			end
		end
	end
end

local elapsed = 0
RunService.Heartbeat:Connect(function(deltaSeconds: number)
	elapsed += deltaSeconds
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end
	local cameraPosition = camera.CFrame.Position
	runTicks(elapsed, cameraPosition)
	runFlickers(elapsed, cameraPosition)
	runFlips(elapsed, cameraPosition)
	local moveParts: { BasePart } = {}
	local moveCFrames: { CFrame } = {}
	for _, entry in swaying do
		if not entry.model.Parent or (entry.rest.Position - cameraPosition).Magnitude > GATE_DISTANCE then
			continue
		end
		local wave = math.sin(elapsed * entry.angularSpeed + entry.phase)
		local wander = math.noise(elapsed * NOISE_SPEED, entry.phase)
		local tiltX = entry.amplitude * ((1 - NOISE_SHARE) * wave + NOISE_SHARE * wander)
		local tiltZ = entry.amplitude * NOISE_SHARE * math.noise(entry.phase, elapsed * NOISE_SPEED)
		local pivot = entry.rest * entry.hingeOffset * CFrame.Angles(tiltX, 0, tiltZ) * entry.hingeInverse
		for index, part in entry.parts do
			table.insert(moveParts, part)
			table.insert(moveCFrames, pivot * entry.partOffsets[index])
		end
	end
	if #moveParts > 0 then
		workspace:BulkMoveTo(moveParts, moveCFrames)
	end
end)
