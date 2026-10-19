--!strict
-- Reward feedback for the game-formula templates. Put this ModuleScript in ReplicatedStorage as
-- "GameFormulaJuice" and the LocalScript GameFormulaFxClient in StarterPlayerScripts, then require this module
-- from server scripts. Every call is cosmetic: it changes no game state and never yields.
--
-- How it works:
-- - The server creates the RemoteEvent "GameFormulaFx" in ReplicatedStorage on first use.
-- - popText, burst, fade, cutscene and pulse fire that event; the client draws the effect locally.
-- - spin and bob only tag the part (CollectionService) and set attributes. The client animates tagged parts
--   with TweenService, so the server position stays still, late joiners get the motion, and the loop
--   costs no replication traffic.

local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local REMOTE_NAME = "GameFormulaFx"
local SPIN_TAG = "GameFormulaSpin"
local BOB_TAG = "GameFormulaBob"
local DEFAULT_COLOR = Color3.fromRGB(255, 221, 64)
local DEFAULT_BURST_COUNT = 12
local MAX_BURST_COUNT = 60
local MAX_TEXT_LENGTH = 24
local DEFAULT_SPIN_SECONDS = 4
local DEFAULT_BOB_HEIGHT = 1
local DEFAULT_FADE_SECONDS = 0.8
local MAX_CUTSCENE_POINTS = 16

local Juice = {}

Juice.remoteName = REMOTE_NAME
Juice.spinTag = SPIN_TAG
Juice.bobTag = BOB_TAG

local remote: RemoteEvent? = nil

local function getRemote(): RemoteEvent
	if remote then
		return remote
	end
	if not RunService:IsServer() then
		local found = ReplicatedStorage:WaitForChild(REMOTE_NAME, 10)
		assert(found and found:IsA("RemoteEvent"), "GameFormulaFx is missing; the server never used the Juice module")
		remote = found
		return found
	end
	local existing = ReplicatedStorage:FindFirstChild(REMOTE_NAME)
	if existing and existing:IsA("RemoteEvent") then
		remote = existing
		return existing
	end
	local created = Instance.new("RemoteEvent")
	created.Name = REMOTE_NAME
	created.Parent = ReplicatedStorage
	remote = created
	return created
end

-- Creates the RemoteEvent early, so a client script can wait for it before the first effect fires.
function Juice.init(): RemoteEvent
	return getRemote()
end

-- Floating text such as "+$25" that rises, scale-pops and fades, shown to every player.
function Juice.popText(position: Vector3, text: string, color: Color3?)
	getRemote():FireAllClients("pop", position, string.sub(text, 1, MAX_TEXT_LENGTH), color or DEFAULT_COLOR)
end

-- A short particle burst at a position, shown to every player.
function Juice.burst(position: Vector3, color: Color3?, count: number?)
	local amount = math.clamp(math.floor(count or DEFAULT_BURST_COUNT), 1, MAX_BURST_COUNT)
	getRemote():FireAllClients("burst", position, color or DEFAULT_COLOR, amount)
end

-- Turns the part around its Y axis forever, one turn per secondsPerTurn. The server CFrame is not changed.
function Juice.spin(part: BasePart, secondsPerTurn: number?)
	part:SetAttribute("GameFormulaSpinSeconds", math.max(secondsPerTurn or DEFAULT_SPIN_SECONDS, 0.1))
	CollectionService:AddTag(part, SPIN_TAG)
end

-- Moves the part up and down by height studs forever. The server CFrame is not changed.
function Juice.bob(part: BasePart, height: number?)
	part:SetAttribute("GameFormulaBobHeight", height or DEFAULT_BOB_HEIGHT)
	CollectionService:AddTag(part, BOB_TAG)
end

-- Fades that player's screen to black and back.
function Juice.fade(player: Player, seconds: number?)
	getRemote():FireClient(player, "fade", math.max(seconds or DEFAULT_FADE_SECONDS, 0.1))
end

-- Flies that player's camera through the CFrames over `seconds`, then back to the player's own view.
function Juice.cutscene(player: Player, cframes: { CFrame }, seconds: number)
	assert(#cframes >= 1 and #cframes <= MAX_CUTSCENE_POINTS, "cutscene needs 1 to 16 CFrames")
	getRemote():FireClient(player, "cutscene", cframes, math.max(seconds, 0.1))
end

-- Pops the HUD label (a TextLabel or TextButton named `label` in the player's PlayerGui) bigger and back.
function Juice.pulse(player: Player, label: string)
	getRemote():FireClient(player, "pulse", label)
end

return Juice
