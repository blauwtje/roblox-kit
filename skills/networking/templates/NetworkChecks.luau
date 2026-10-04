--!strict
-- Server half of the networking bad-data playtest. Put this ModuleScript next to Pickups and Rejections in
-- ServerScriptService, put NetworkClientChecks in ReplicatedStorage, and run both in one multiplayer or play-mode
-- playtest (the playtest skill covers the call):
--   serverChecks: require(game.ServerScriptService.NetworkChecks)(check, expectedClients)
--   clientChecks: require(game.ReplicatedStorage.NetworkClientChecks)(check, player)
--
-- For each expected client this module builds pickup fixtures around the player's character, waits for the
-- client's final valid pickup (the end marker, sent after every bad send), then checks that
--   * the inventory holds only that item,
--   * every other fixture is where, under whom and owned by whom it started,
--   * each reason the client provoked was counted by Rejections.
-- Sends Blink itself rejects (wrong classes, out-of-range slots, raw malformed payloads) never reach game code, so
-- they have no count; the untouched fixtures and the one-item inventory prove they changed nothing.
-- Slot values outside 1..8 and a cut-short DropItem are rejected by Blink, so they leave no count. They are
-- observed through the total: every DropItem call that reaches game code is rejected and counted, so the DropItem
-- reasons must add up to the NaN, infinite and flood sends and not one more.
-- The client learns the fixture names and the flood size from this module through a player attribute (see
-- FIXTURE_ATTRIBUTE), so each is defined once.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local Pickups = require(script.Parent.Pickups)
local Rejections = require(script.Parent.Rejections)

type Check = (name: string, passed: boolean, detail: string?) -> ()

type Snapshot = {
	instance: Instance,
	parent: Instance?,
	position: Vector3,
	owner: any,
}

local PLAYER_WAIT_SECONDS = 30
local CHARACTER_WAIT_SECONDS = 30
local END_MARKER_WAIT_SECONDS = 60
local NEAR_OFFSET = Vector3.new(4, 0, 0)
local FAR_OFFSET = Vector3.new(200, 0, 0)
local PART_SIZE = 2
local FLOOD_SIZE = 40 -- DropItem calls the client sends in one frame, past the rate limit
local FIXTURE_ATTRIBUTE = "NetworkFixtures" -- read by NetworkClientChecks: JSON of fixtureNames and floodSize

local function waitUntil(condition: () -> boolean, seconds: number): boolean
	local deadline = os.clock() + seconds
	while os.clock() < deadline do
		if condition() then
			return true
		end
		task.wait(0.1)
	end
	return condition()
end

local function characterPosition(player: Player): Vector3?
	local character = player.Character
	if character == nil then
		return nil
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if humanoid == nil or humanoid.Health <= 0 then
		return nil
	end
	return character:GetPivot().Position
end

local function makeModel(name: string, position: Vector3, parent: Instance, owner: number?): Model
	local model = Instance.new("Model")
	model.Name = name
	local part = Instance.new("Part")
	part.Size = Vector3.one * PART_SIZE
	part.Anchored = true
	part.Position = position
	part.Parent = model
	model.PrimaryPart = part
	if owner ~= nil then
		model:SetAttribute("OwnerUserId", owner)
	end
	model.Parent = parent
	return model
end

local function makePart(name: string, position: Vector3, parent: Instance): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Size = Vector3.one * PART_SIZE
	part.Anchored = true
	part.Position = position
	part.Parent = parent
	return part
end

local function snapshot(instance: Instance): Snapshot
	return {
		instance = instance,
		parent = instance.Parent,
		position = if instance:IsA("Model") then instance:GetPivot().Position else (instance :: Part).Position,
		owner = instance:GetAttribute("OwnerUserId"),
	}
end

local function isUntouched(before: Snapshot): boolean
	local instance = before.instance
	if instance.Parent ~= before.parent then
		return false
	end
	if instance:GetAttribute("OwnerUserId") ~= before.owner then
		return false
	end
	local position = if instance:IsA("Model") then instance:GetPivot().Position else (instance :: Part).Position
	return position == before.position
end

local function countItems(items: { [number]: string }): number
	local count = 0
	for _ in items do
		count += 1
	end
	return count
end

-- Expected counts: exact where one send provokes one game-code rejection, a minimum where a flood does.
local exactReasons: { [string]: number } = {
	["RequestPickup.ownedByOther"] = 1,
	["RequestPickup.tooFar"] = 1,
	-- The item outside workspace.Pickups and the Workspace itself, which passes Blink's Instance(Model) check.
	["RequestPickup.outsideItems"] = 2,
	["DropItem.notFinite"] = 2,
}
local minimumReasons: { [string]: number } = {
	["DropItem.emptySlot"] = 1,
	["DropItem.rateLimited"] = 1,
}

local function checkPlayer(check: Check, player: Player, validName: string, untouched: { Snapshot }, pickups: Folder)
	local prefix = `{player.Name}: `
	local gotMarker = waitUntil(function()
		return Pickups.getItems(player)[1] ~= nil
	end, END_MARKER_WAIT_SECONDS)
	check(`{prefix}the final valid pickup arrived`, gotMarker, `valid item {validName}`)

	local items = Pickups.getItems(player)
	check(
		`{prefix}the inventory holds only the valid item`,
		countItems(items) == 1 and items[1] == validName,
		`slots: {countItems(items)}, slot 1: {items[1]}`
	)
	check(`{prefix}the valid fixture was picked up`, pickups:FindFirstChild(validName) == nil)

	local changed: { string } = {}
	for _, before in untouched do
		if not isUntouched(before) then
			table.insert(changed, before.instance.Name)
		end
	end
	check(`{prefix}every other fixture is untouched`, #changed == 0, `changed: {table.concat(changed, ", ")}`)

	local dropRejections = 0
	for reason, count in Rejections.get(player) do
		if string.sub(reason, 1, #"DropItem.") == "DropItem." then
			dropRejections += count
		end
	end
	local expectedDropRejections = FLOOD_SIZE + exactReasons["DropItem.notFinite"]
	check(
		`{prefix}every DropItem call that reached game code was rejected, and no out-of-range slot got through`,
		dropRejections == expectedDropRejections,
		`rejections: {dropRejections}, expected: {expectedDropRejections}`
	)

	for reason, expected in exactReasons do
		local count = Rejections.count(player, reason)
		check(`{prefix}{reason} counted {expected}`, count == expected, `count: {count}`)
	end
	for reason, minimum in minimumReasons do
		local count = Rejections.count(player, reason)
		check(`{prefix}{reason} counted at least {minimum}`, count >= minimum, `count: {count}`)
	end
end

-- The client finds these by the names sent in FIXTURE_ATTRIBUTE; the names carry the player's UserId so several
-- clients never collide.
local function fixtureNames(userId: number)
	return {
		valid = `Valid_{userId}`,
		far = `Far_{userId}`,
		foreign = `Foreign_{userId}`,
		notModel = `NotModel_{userId}`,
		outside = `Outside_{userId}`,
	}
end

return function(check: Check, expectedClients: number)
	if expectedClients < 1 then
		check("NetworkChecks needs a client", false, "run a play or multiplayer playtest with clientChecks")
		return
	end

	local enough = waitUntil(function()
		return #Players:GetPlayers() >= expectedClients
	end, PLAYER_WAIT_SECONDS)
	if not enough then
		check("the expected clients joined", false, `{#Players:GetPlayers()} of {expectedClients}`)
		return
	end

	local pickups = workspace:FindFirstChild("Pickups")
	local createdFolder = false
	if pickups == nil then
		local folder = Instance.new("Folder")
		folder.Name = "Pickups"
		folder.Parent = workspace
		pickups = folder
		createdFolder = true
	end
	local pickupsFolder = pickups :: Folder

	-- Fixtures come first for every player, so no client waits on another player's character.
	local fixturesByPlayer: { [Player]: { validName: string, untouched: { Snapshot }, all: { Instance } } } = {}
	for _, player in Players:GetPlayers() do
		local alive = waitUntil(function()
			return characterPosition(player) ~= nil
		end, CHARACTER_WAIT_SECONDS)
		local origin = characterPosition(player)
		if not alive or origin == nil then
			check(`{player.Name}: has a living character`, false, "no character before the deadline")
			continue
		end
		local names = fixtureNames(player.UserId)
		local valid = makeModel(names.valid, origin + NEAR_OFFSET, pickupsFolder, nil)
		local far = makeModel(names.far, origin + FAR_OFFSET, pickupsFolder, nil)
		local foreign = makeModel(names.foreign, origin + NEAR_OFFSET, pickupsFolder, player.UserId + 1)
		local notModel = makePart(names.notModel, origin + NEAR_OFFSET, pickupsFolder)
		local outside = makeModel(names.outside, origin + NEAR_OFFSET, workspace, nil)
		local untouched = { snapshot(far), snapshot(foreign), snapshot(notModel), snapshot(outside) }
		fixturesByPlayer[player] = {
			validName = valid.Name,
			untouched = untouched,
			all = { valid, far, foreign, notModel, outside },
		}
		-- Set after the fixtures exist, so a client that sees the names can find the fixtures.
		player:SetAttribute(FIXTURE_ATTRIBUTE, HttpService:JSONEncode({ names = names, floodSize = FLOOD_SIZE }))
	end

	for player, fixtures in fixturesByPlayer do
		checkPlayer(check, player, fixtures.validName, fixtures.untouched, pickupsFolder)
	end

	for player, fixtures in fixturesByPlayer do
		player:SetAttribute(FIXTURE_ATTRIBUTE, nil)
		for _, instance in fixtures.all do
			instance:Destroy()
		end
	end
	if createdFolder then
		pickupsFolder:Destroy()
	end
end
