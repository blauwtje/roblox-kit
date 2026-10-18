--!strict
-- Probe file for smoke:studio: records whether the avatar, Animator and animation calls the NPCs may use work in edit mode.
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

-- Roblox's default R15 idle animation.
local DEFAULT_IDLE_ANIMATION = "rbxassetid://507766666"

type Result = { name: string, ok: boolean, detail: string }

local results: { Result } = {}

local function record(name: string, attempt: () -> string)
	local succeeded, outcome = pcall(attempt)
	table.insert(results, { name = name, ok = succeeded, detail = tostring(outcome) })
end

local rig: Model? = nil

record("CreateHumanoidModelFromDescriptionAsync", function()
	local model =
		Players:CreateHumanoidModelFromDescriptionAsync(Instance.new("HumanoidDescription"), Enum.HumanoidRigType.R15)
	rig = model
	return `built {model.Name} with {#model:GetDescendants()} descendants`
end)

local function animatorOfRig(): Animator
	local model = rig
	if model == nil then
		error("no rig: CreateHumanoidModelFromDescriptionAsync failed", 0)
	end
	local humanoid = model:FindFirstChildWhichIsA("Humanoid")
	if humanoid == nil then
		error("rig has no Humanoid", 0)
	end
	local existing = humanoid:FindFirstChildWhichIsA("Animator")
	if existing ~= nil then
		return existing
	end
	local animator = Instance.new("Animator")
	animator.Parent = humanoid
	return animator
end

record("Animator:StepAnimations", function()
	animatorOfRig():StepAnimations(0.1)
	return "StepAnimations accepted"
end)

record("default idle animation", function()
	local animation = Instance.new("Animation")
	animation.AnimationId = DEFAULT_IDLE_ANIMATION
	local track = animatorOfRig():LoadAnimation(animation)
	animation:Destroy()
	local length = track.Length
	track:Destroy()
	return `loaded {DEFAULT_IDLE_ANIMATION}, length {length}`
end)

if rig ~= nil then
	(rig :: Model):Destroy()
end

return HttpService:JSONEncode(results)
