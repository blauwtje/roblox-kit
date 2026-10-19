--!strict
-- Playtest checks for the plus-one-escape template. Run this chunk body on the server of a solo play-mode
-- playtest, after PlusOneMain.server has started the game. It drives the loop through the PlusOneGame functions,
-- calls error() with the first failure and otherwise returns a summary table. It leaves the world photogenic:
-- the first gates broken and the player mid-track in front of the next one.
local Players = game:GetService("Players")
local ServerScriptService = game:GetService("ServerScriptService")

local Game = require(ServerScriptService:WaitForChild("PlusOneGame"))
local config = Game.config

local WAIT_SECONDS = 30

local function expect(condition: boolean, message: string)
	if not condition then
		error(`plus-one-escape check failed: {message}`, 2)
	end
end

local function waitFor<T>(description: string, find: () -> T?): T
	local deadline = os.clock() + WAIT_SECONDS
	while os.clock() < deadline do
		local found = find()
		if found ~= nil then
			return found
		end
		task.wait(0.1)
	end
	error(`plus-one-escape check failed: timed out waiting for {description}`)
end

local player = waitFor("the test player", function()
	return Players:GetPlayers()[1]
end)
local root = waitFor("the player's character", function()
	local character = player.Character
	local part = if character ~= nil then character:FindFirstChild("HumanoidRootPart") else nil
	return if part ~= nil and part:IsA("BasePart") then part else nil
end)
waitFor("the game state", function()
	return Game.getState(player)
end)
local worldFolder = waitFor("the world folder", function()
	return workspace:FindFirstChild(config.folderName)
end)
local leaderstats = player:WaitForChild("leaderstats")
local function stat(name: string): number
	local value = leaderstats:WaitForChild(name)
	return (value :: IntValue).Value
end

Game.setAutoTick(false)
local summary: { [string]: any } = {}

local function expectedGain(): number
	return math.floor(config.strengthPerTick * (1 + stat("Rebirths") * config.rebirthMultiplierStep))
end

-- Fresh start. Auto-tick ran from the moment the player joined until setAutoTick(false) above, so Strength
-- holds only whole auto-tick gains; Wins and Rebirths start at zero.
expect(stat("Wins") == 0 and stat("Rebirths") == 0, "Wins and Rebirths should start at zero")
expect(
	stat("Strength") >= 0 and stat("Strength") % expectedGain() == 0,
	`Strength should hold only whole auto-tick gains of {expectedGain()}, got {stat("Strength")}`
)
local early = Game.rebirth(player)
expect(not early.ok, "rebirth should refuse with no Wins")
local lobbyOffset = Game.getLobbyCFrame():PointToObjectSpace(root.Position)
expect(math.abs(lobbyOffset.X) < config.lobbySize / 2, "the player should start in the lobby")

-- Tick off a pad.
expect(Game.padFactor(player) == 1, "the spawn must not be on a training pad")
local seconds = 5
local before = stat("Strength")
Game.tick(player, seconds)
local gained = stat("Strength") - before
expect(
	gained == expectedGain() * seconds / config.tickSeconds,
	`{seconds} s should give {expectedGain() * seconds / config.tickSeconds} Strength, got {gained}`
)
summary.tickGain = gained

-- Tick on a training pad.
local pads = Game.getPads()
expect(#pads > 0, "the world should have training pads")
player.Character:PivotTo(pads[1].CFrame + Vector3.new(0, 3, 0))
task.wait(0.2) -- the character may fall slightly; it stays within the pad headroom
expect(Game.padFactor(player) == config.padMultiplier, "standing on a pad should give the pad factor")
before = stat("Strength")
Game.tick(player, 2)
gained = stat("Strength") - before
expect(
	gained == expectedGain() * config.padMultiplier * 2 / config.tickSeconds,
	`2 ticks on a pad should multiply by {config.padMultiplier}, got +{gained}`
)
summary.padGain = gained

-- Gates.
local need1 = Game.gateThreshold(1)
Game.setStrength(player, need1 - 1)
local weak = Game.tryGate(player, 1)
expect(not weak.ok and weak.reason == "too weak", "gate 1 should refuse with one Strength too few")
expect(not Game.isGateBroken(1), "a refused gate must stay whole")
expect((Game.getState(player) :: any).checkpoint == 0, "a refused gate must not set a checkpoint")
local skipped = Game.tryGate(player, 2)
expect(not skipped.ok and skipped.reason == "locked", "gate 2 should be locked before gate 1")
Game.setStrength(player, need1)
local strong = Game.tryGate(player, 1)
expect(strong.ok and strong.reason == "opened", "gate 1 should open with exactly enough Strength")
expect(Game.isGateBroken(1), "an opened gate should shatter")
expect((Game.getState(player) :: any).checkpoint == 1, "opening gate 1 should set checkpoint 1")
expect(player:GetAttribute("NextGate") == Game.gateThreshold(2), "the NextGate attribute should show gate 2")
for stage = 2, config.stageCount do
	expect(
		Game.gateThreshold(stage) > Game.gateThreshold(stage - 1),
		`gate {stage} should need more than gate {stage - 1}`
	)
end
summary.gateThresholds = Game.gateThreshold(config.stageCount)

-- Finish needs every gate.
local tooEarly = Game.finish(player)
expect(not tooEarly.ok, "finish should refuse with gates remaining")
for stage = 2, config.stageCount do
	Game.setStrength(player, Game.gateThreshold(stage))
	expect(Game.tryGate(player, stage).ok, `gate {stage} should open`)
end
local winsBefore = stat("Wins")
local won = Game.finish(player)
expect(won.ok, "finish should work after the last gate")
expect(stat("Wins") == winsBefore + 1, "finish should add one Win")
waitFor("the win sequence to end", function()
	return if Game.isWinning(player) then nil else true
end)
task.wait(0.2)
local afterWin = Game.getLobbyCFrame():PointToObjectSpace(root.Position)
expect(
	math.abs(afterWin.Z) < config.lobbySize / 2 and afterWin.Y < 20,
	`finish should teleport the player to the lobby, got {root.Position}`
)
expect((Game.getState(player) :: any).checkpoint == 0, "finish should reset the checkpoint")
summary.wins = stat("Wins")

-- Rebirth.
local reborn = Game.rebirth(player)
expect(reborn.ok, "rebirth should work with enough Wins")
expect(stat("Rebirths") == 1 and stat("Strength") == 0, "rebirth should add a rebirth and reset Strength")
expect(Game.multiplier(player) == 1 + config.rebirthMultiplierStep, "the multiplier should rise by one step")
player.Character:PivotTo(Game.getLobbyCFrame() + Vector3.new(0, 4, 0))
task.wait(0.2)
before = stat("Strength")
Game.tick(player, 3)
gained = stat("Strength") - before
expect(
	gained == expectedGain() * 3 / config.tickSeconds and expectedGain() > config.strengthPerTick,
	`after a rebirth 3 ticks should give {expectedGain() * 3 / config.tickSeconds}, got {gained}`
)
summary.rebirthGain = gained

-- Photogenic end state: gates before the shot gate broken, the player standing in front of it.
Game.reformAllGates()
for stage = 1, config.shotGateStage - 1 do
	Game.setStrength(player, Game.gateThreshold(stage))
	expect(Game.tryGate(player, stage).ok, `gate {stage} should open`)
end
Game.setStrength(player, Game.gateThreshold(config.shotGateStage) // 2)
local shotGate = (worldFolder :: Folder):FindFirstChild(`Gate{config.shotGateStage}`)
expect(shotGate ~= nil, "the shot gate should exist")
local gatePart = (shotGate :: Folder):FindFirstChildWhichIsA("BasePart")
expect(gatePart ~= nil, "the shot gate should have parts")
player.Character:PivotTo(CFrame.new(0, 4, (gatePart :: BasePart).Position.Z + 30))
local shots = (worldFolder :: Folder):FindFirstChild("Shots")
expect(shots ~= nil and #(shots :: Folder):GetChildren() == 3, "Shots should hold three camera parts")
Game.setAutoTick(true)
summary.shots = 3
return summary
