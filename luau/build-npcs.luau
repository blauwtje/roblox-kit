--!strict
-- Builds the posed NPCs of a map in edit mode under `<map>/Npcs`, one Model each with its behavior as attributes,
-- and installs the pooled client script. Tries an avatar from a HumanoidDescription first and falls back to a
-- plain part rig when that fails (it needs web access). Reads its inputs as data from `arguments`.
type Vector = { x: number, y: number, z: number }
type Outfit = { head: string, torso: string, arms: string, legs: string, scale: { min: number, max: number } }
type Npc = {
	id: string,
	role: string,
	behavior: string,
	position: Vector,
	yaw: number,
	seatId: number?,
	route: { { x: number, z: number } }?,
	phase: number,
	outfit: Outfit,
	speed: number,
	chatLines: { string },
}
type Arguments = {
	mapId: string,
	mapsFolderName: string,
	npcs: { Npc },
	graph: { nodes: { any }, edges: { any } },
	sightRadius: number,
	bubbleInterval: number,
	clientScriptSource: string,
}

local arguments: Arguments = ...
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local StarterPlayer = game:GetService("StarterPlayer")
local mapHelpers = require("./shared/map-helpers")

local FOLDER_NAME = "Npcs"
local SCRIPT_NAME = "RobloxKitNpcRuntime"
local SEAT_LIFT = 1.2
local ROOT_HEIGHT = 3

local warnings: { string } = {}

local function color(hex: string): Color3
	return Color3.fromHex(hex)
end

local function avatar(npc: Npc): Model?
	local description = Instance.new("HumanoidDescription")
	local outfit = npc.outfit
	description.HeadColor = color(outfit.head)
	description.TorsoColor = color(outfit.torso)
	description.LeftArmColor = color(outfit.arms)
	description.RightArmColor = color(outfit.arms)
	description.LeftLegColor = color(outfit.legs)
	description.RightLegColor = color(outfit.legs)
	local ok, model = pcall(function()
		return Players:CreateHumanoidModelFromDescriptionAsync(description, Enum.HumanoidRigType.R15)
	end)
	description:Destroy()
	if not ok then
		return nil
	end
	return model :: Model
end

local function addPart(model: Model, name: string, size: Vector3, offset: Vector3, hex: string, root: BasePart)
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.Color = color(hex)
	part.Anchored = false
	part.CanCollide = false
	part.CFrame = root.CFrame * CFrame.new(offset)
	part.Parent = model
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = root
	weld.Part1 = part
	weld.Parent = part
end

local function rig(npc: Npc): Model
	local model = Instance.new("Model")
	local outfit = npc.outfit
	local root = Instance.new("Part")
	root.Name = "HumanoidRootPart"
	root.Size = Vector3.new(2, 2, 1)
	root.Color = color(outfit.torso)
	root.Anchored = true
	root.CanCollide = false
	root.Parent = model
	model.PrimaryPart = root
	addPart(model, "Head", Vector3.new(1.2, 1.2, 1.2), Vector3.new(0, 1.6, 0), outfit.head, root)
	addPart(model, "LeftArm", Vector3.new(1, 2, 1), Vector3.new(-1.5, 0, 0), outfit.arms, root)
	addPart(model, "RightArm", Vector3.new(1, 2, 1), Vector3.new(1.5, 0, 0), outfit.arms, root)
	addPart(model, "LeftLeg", Vector3.new(1, 2, 1), Vector3.new(-0.5, -2, 0), outfit.legs, root)
	addPart(model, "RightLeg", Vector3.new(1, 2, 1), Vector3.new(0.5, -2, 0), outfit.legs, root)
	Instance.new("Humanoid").Parent = model
	return model
end

local function place(model: Model, npc: Npc)
	local lift = if npc.behavior == "sit" then SEAT_LIFT else ROOT_HEIGHT
	local position = Vector3.new(npc.position.x, npc.position.y + lift, npc.position.z)
	local scale = (npc.outfit.scale.min + npc.outfit.scale.max) / 2
	pcall(function()
		model:ScaleTo(scale)
	end)
	model:PivotTo(CFrame.new(position) * CFrame.Angles(0, math.rad(npc.yaw), 0))
	for _, descendant in model:GetDescendants() do
		if descendant:IsA("BasePart") then
			descendant.Anchored = true
		end
	end
end

local function annotate(model: Model, npc: Npc)
	model.Name = npc.id
	model:SetAttribute("Behavior", npc.behavior)
	model:SetAttribute("Role", npc.role)
	model:SetAttribute("Phase", npc.phase)
	model:SetAttribute("Speed", npc.speed)
	model:SetAttribute("SeatId", npc.seatId)
	model:SetAttribute("ChatLines", HttpService:JSONEncode(npc.chatLines))
	if npc.route ~= nil then
		model:SetAttribute("Route", HttpService:JSONEncode(npc.route))
	end
end

local function installScript(source: string)
	local scripts = StarterPlayer:FindFirstChild("StarterPlayerScripts") :: Instance
	local existing = scripts:FindFirstChild(SCRIPT_NAME)
	if existing then
		existing:Destroy()
	end
	local runtime = Instance.new("LocalScript")
	runtime.Name = SCRIPT_NAME
	runtime.Source = source
	runtime.Parent = scripts
end

local mapModel = mapHelpers.findMapModel(arguments.mapsFolderName, arguments.mapId)
if mapModel == nil then
	error(`Map "{arguments.mapId}" is not built`)
end

local old = mapModel:FindFirstChild(FOLDER_NAME)
if old then
	old:Destroy()
end
local folder = Instance.new("Folder")
folder.Name = FOLDER_NAME
folder:SetAttribute("RouteGraph", HttpService:JSONEncode(arguments.graph))
folder:SetAttribute("SightRadius", arguments.sightRadius)
folder:SetAttribute("BubbleInterval", arguments.bubbleInterval)

local avatars = 0
for _, npc in arguments.npcs do
	local made = avatar(npc)
	if made ~= nil then
		avatars += 1
	end
	local model: Model = made or rig(npc)
	annotate(model, npc)
	place(model, npc)
	model.Parent = folder
end
folder.Parent = mapModel

local total = #arguments.npcs
local characterPath = if total > 0 and avatars == total then "avatar" else "rig"
if avatars > 0 and avatars < total then
	table.insert(warnings, `{total - avatars} of {total} NPCs fell back to the part rig`)
elseif total > 0 and avatars == 0 then
	table.insert(warnings, "avatar creation failed; every NPC uses the part rig")
end

installScript(arguments.clientScriptSource)

return HttpService:JSONEncode({ built = total, characterPath = characterPath, warnings = warnings })
