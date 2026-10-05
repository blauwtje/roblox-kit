--!strict
-- Server Script that build_map places under a map Model when its style animates prop kinds. Every
-- descendant Model of the map with an `IdleSwayDegrees` attribute sways about a hinge at the top or bottom
-- of its box (`IdleHinge`), around its own X axis, with a sine of period `IdlePeriodSeconds` plus a little
-- noise on both axes; its `Seed` attribute offsets the phase so neighbors do not swing in step. Each angle is
-- taken from the pivot the Model had when the Script started, so the sway never drifts.
local RunService = game:GetService("RunService")

-- Share of the sway that comes from noise rather than the sine, and how fast the noise wanders.
local NOISE_SHARE = 0.35
local NOISE_SPEED = 0.4

type Swaying = {
	model: Model,
	rest: CFrame,
	hingeOffset: CFrame,
	amplitude: number,
	angularSpeed: number,
	phase: number,
}

local map = script.Parent
assert(map, "The idle animation Script needs its map Model as parent.")

local function swayingOf(model: Model): Swaying?
	local swayDegrees = model:GetAttribute("IdleSwayDegrees")
	local periodSeconds = model:GetAttribute("IdlePeriodSeconds")
	if type(swayDegrees) ~= "number" or type(periodSeconds) ~= "number" or periodSeconds <= 0 then
		return nil
	end
	local _, size = model:GetBoundingBox()
	local direction = if model:GetAttribute("IdleHinge") == "bottom" then -1 else 1
	local seed = model:GetAttribute("Seed")
	return {
		model = model,
		rest = model:GetPivot(),
		hingeOffset = CFrame.new(0, direction * size.Y / 2, 0),
		amplitude = math.rad(swayDegrees),
		angularSpeed = 2 * math.pi / periodSeconds,
		phase = if type(seed) == "number" then (seed % 1000) / 1000 * 2 * math.pi else 0,
	}
end

local swaying: { Swaying } = {}
for _, descendant in map:GetDescendants() do
	if descendant:IsA("Model") then
		local entry = swayingOf(descendant)
		if entry then
			table.insert(swaying, entry)
		end
	end
end

local elapsed = 0
RunService.Heartbeat:Connect(function(deltaSeconds: number)
	elapsed += deltaSeconds
	for _, entry in swaying do
		if not entry.model.Parent then
			continue
		end
		local wave = math.sin(elapsed * entry.angularSpeed + entry.phase)
		local wander = math.noise(elapsed * NOISE_SPEED, entry.phase)
		local tiltX = entry.amplitude * ((1 - NOISE_SHARE) * wave + NOISE_SHARE * wander)
		local tiltZ = entry.amplitude * NOISE_SHARE * math.noise(entry.phase, elapsed * NOISE_SPEED)
		local hinge = entry.rest * entry.hingeOffset
		entry.model:PivotTo(hinge * CFrame.Angles(tiltX, 0, tiltZ) * entry.hingeOffset:Inverse())
	end
end)
