--!strict
-- Playtest checks for the Steal an Egg template. This is a chunk body, not a ModuleScript: run it on the server of a
-- solo playtest (run_playtest serverChecks) with StealEggGame started by StealEggMain.server and GameFormulaJuice present.
-- It drives the loop through the StealEggGame API with the one test player and a fake rival owner, calls error()
-- with a clear message on the first failure and otherwise returns a summary table. It ends with a photogenic world
-- (eggs on the player's pads, a full conveyor, a rival base) and Workspace.GameFormulaStealEgg.Shots set for captures.
local Players = game:GetService("Players")
local ServerScriptService = game:GetService("ServerScriptService")

local Game = require(ServerScriptService:WaitForChild("StealEggGame")) :: any
local Config = Game.Config

local PLAYER_WAIT_SECONDS = 30
local INCOME_SECONDS = 10
local EPSILON = 1e-6
local FLIGHT_MARGIN_SECONDS = 0.4
local RIVAL_NAME = "Rival"

local function expect(condition: boolean, message: string)
	if not condition then
		error("Steal an Egg check failed: " .. message, 0)
	end
end

local function near(actual: number, expected: number, message: string)
	expect(
		math.abs(actual - expected) <= EPSILON * math.max(1, math.abs(expected)),
		message .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual)
	)
end

local function waitForPlayer(): Player
	local deadline = os.clock() + PLAYER_WAIT_SECONDS
	while os.clock() < deadline do
		for _, candidate in Players:GetPlayers() do
			if Game.plotOf(candidate) ~= nil and candidate:FindFirstChild("leaderstats") ~= nil then
				return candidate
			end
		end
		task.wait(0.25)
	end
	error(
		"Steal an Egg check failed: no player with a base and leaderstats within "
			.. tostring(PLAYER_WAIT_SECONDS)
			.. "s",
		0
	)
end

local function waitForCharacter(player: Player): Humanoid?
	local deadline = os.clock() + PLAYER_WAIT_SECONDS
	while os.clock() < deadline do
		local character = player.Character
		local humanoid = if character ~= nil then character:FindFirstChildOfClass("Humanoid") else nil
		if humanoid ~= nil then
			return humanoid
		end
		task.wait(0.25)
	end
	return nil
end

local player = waitForPlayer()
local humanoid = waitForCharacter(player)
local plot = Game.plotOf(player)
expect(plot ~= nil, "the player has no base")
local world = workspace:FindFirstChild(Config.folderName)
expect(world ~= nil and world:IsA("Folder"), "Workspace." .. Config.folderName .. " is missing")

Game.setAutoSpawn(false)
Game.clearConveyor()
local rarities = Config.rarities
local summary: { [string]: any } = {}

-- Buy: an egg rides the conveyor, is bought and lands on a pad.
local common = rarities[1]
local cash = (player:FindFirstChild("leaderstats") :: Folder):FindFirstChild("Cash") :: NumberValue
cash.Value = common.price * 3
local eggId = Game.spawnEgg(1)
expect(eggId ~= nil, "spawnEgg returned no id")
local cashBeforeBuy = Game.getCash(player)
Game.setAutoSpawn(false)
local broke, brokeReason = Game.buyEgg(player, 9999999)
expect(not broke, "buying a missing egg succeeded (" .. brokeReason .. ")")
local bought, buyReason = Game.buyEgg(player, eggId)
expect(bought, "buyEgg failed: " .. buyReason)
near(Game.getCash(player), cashBeforeBuy - common.price, "cash after buying")
expect(Game.eggCount(plot) == 1, "the bought egg is not on a pad")
expect(plot.eggs[1] ~= nil, "the first bought egg is not on pad 1")
task.wait(Config.eggFlightSeconds + FLIGHT_MARGIN_SECONDS)
local landed = plot.eggs[1].part
expect(landed.Parent ~= nil, "the bought egg part was destroyed")
expect((landed.Position - plot.pads[1].Position).Magnitude < Config.eggSize.Y + 1, "the egg did not land on its pad")
cash.Value = 0
local poor = Game.spawnEgg(2)
local poorOk = Game.buyEgg(player, poor)
expect(not poorOk, "buying without enough cash succeeded")
expect(Game.eggCount(plot) == 1, "a failed buy placed an egg")
Game.clearConveyor()
summary.buy = "ok"

-- Income and collect, with no yield between reading and ticking so Heartbeat cannot interfere.
local income = Game.incomePerSecond(plot)
near(income, common.income * Game.incomeMultiplier(player), "income per second")
local pendingBefore = plot.pending
Game.tick(INCOME_SECONDS)
near(plot.pending - pendingBefore, income * INCOME_SECONDS, "pending income after the tick")
local pendingNow = plot.pending
local cashBeforeCollect = Game.getCash(player)
local banked = Game.collect(player)
near(banked, math.floor(pendingNow), "collected amount")
near(Game.getCash(player) - cashBeforeCollect, banked, "cash rise after collecting")
expect(plot.pending < 1, "the pile was not emptied")
summary.collected = banked

-- Steal from a pretend owner.
local rival = Game.claimFakePlot(RIVAL_NAME)
expect(rival ~= nil, "no free base for the rival")
local rivalPad = Game.placeEgg(rival, 3)
expect(rivalPad ~= nil, "could not place a rival egg")
Game.placeEgg(rival, 2)
local ownStolen = Game.steal(player, plot, 1)
expect(not ownStolen, "stealing from your own base succeeded")

expect(Game.lockPlot(rival), "locking the rival base failed")
local lockedSteal = Game.steal(player, rival, rivalPad)
expect(not lockedSteal, "stealing from a locked base succeeded")
expect(Game.eggCount(rival) == 2, "the locked base lost an egg")
for _, wall in rival.barrier do
	expect(wall.CanCollide and wall.Transparency < 1, "the barrier is not up on a locked base")
end
expect(not Game.lockPlot(rival), "locking an already locked base succeeded")
Game.tick(Config.lockSeconds)
expect(rival.lockRemaining == 0, "the lock did not expire")
for _, wall in rival.barrier do
	expect(not wall.CanCollide, "the barrier stayed solid after the lock expired")
end

local walkSpeedBefore = if humanoid ~= nil then humanoid.WalkSpeed else nil
local ownEggsBefore = Game.eggCount(plot)
local stolen, stealReason = Game.steal(player, rival, rivalPad)
expect(stolen, "steal failed: " .. stealReason)
expect(Game.eggCount(rival) == 1, "the rival still has the stolen egg")
expect(Game.isCarrying(player), "the thief is not carrying the egg")
local second = Game.steal(player, rival, 2)
expect(not second, "a carrying thief stole a second egg")
if humanoid ~= nil then
	expect(humanoid.WalkSpeed == Config.carrySpeed, "carrying did not lower the walk speed")
end
local delivered, deliverReason = Game.deliver(player)
expect(delivered, "deliver failed: " .. deliverReason)
expect(not Game.isCarrying(player), "still carrying after delivering")
expect(Game.eggCount(plot) == ownEggsBefore + 1, "the stolen egg is not on the thief's base")
if humanoid ~= nil then
	expect(humanoid.WalkSpeed == walkSpeedBefore, "delivering did not restore the walk speed")
end
summary.steal = "ok"

-- The owner's own lock button: lockBase raises the barrier on the player's plot and it expires.
expect(Game.lockBase(player), "lockBase failed for the owner")
expect(plot.lockRemaining == Config.lockSeconds, "lock duration is not Config.lockSeconds")
Game.tick(Config.lockSeconds)
expect(plot.lockRemaining == 0, "the owner's lock did not expire")
summary.lock = "ok"

-- Rebirth.
cash.Value = 0
local tooEarly = Game.rebirth(player)
expect(not tooEarly, "rebirth succeeded without the cash")
local rebirthsBefore = Game.getRebirths(player)
local cost = Game.rebirthCost(rebirthsBefore)
cash.Value = cost
local rebirthed, rebirthReason = Game.rebirth(player)
expect(rebirthed, "rebirth failed: " .. rebirthReason)
near(Game.getCash(player), Config.startCash, "cash after rebirth")
expect(Game.eggCount(plot) == 0, "rebirth kept the eggs")
expect(Game.getRebirths(player) == rebirthsBefore + 1, "Rebirths did not rise")
near(Game.incomeMultiplier(player), 1 + (rebirthsBefore + 1) * Config.rebirthIncomeBonus, "income multiplier")
Game.placeEgg(plot, 1)
near(Game.incomePerSecond(plot), common.income * Game.incomeMultiplier(player), "income after rebirth")
expect(Game.rebirthCost(rebirthsBefore + 1) > cost, "the next rebirth is not dearer")
summary.rebirth = "ok"

-- Photogenic final state: eggs on the pads, a stocked rival, a full conveyor, Shot2 on the player's base.
Game.releasePlot(plot)
plot.owner = player
Game.releasePlot(rival)
Game.claimFakePlot(RIVAL_NAME)
local showcase = { 5, 4, 3, 2, 3, 1 }
for index = 1, Config.padsPerPlot do
	Game.placeEgg(plot, showcase[(index - 1) % #showcase + 1])
end
for index = 1, 4 do
	Game.placeEgg(rival, showcase[index])
end
Game.clearConveyor()
for _ = 1, Config.maxConveyorEggs do
	Game.spawnEgg(nil)
	Game.tick(Config.spawnInterval)
end
Game.tick(Config.spawnInterval)
Game.setAutoSpawn(true)
Game.focusShot(plot)
local shots = world:FindFirstChild("Shots")
expect(shots ~= nil and #shots:GetChildren() == 3, "Shots must hold three camera parts")
summary.conveyorEggs = #Game.conveyorEggIds()
summary.padEggs = Game.eggCount(plot)
summary.rebirths = Game.getRebirths(player)
expect(summary.padEggs == Config.padsPerPlot, "the player's pads are not full for the screenshot")
expect(summary.conveyorEggs > 0, "the conveyor is empty for the screenshot")
return summary
