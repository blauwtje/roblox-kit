--!strict
-- Server-authoritative pickups and drops. Put this ModuleScript next to RateLimit, Rejections and Validate, with
-- the generated Blink server file at ServerScriptService.Network. Main.server.luau starts it and connects the
-- handlers once.
--
-- The client sends intent only (which item it wants, which slot it drops and where); the server decides every
-- outcome. Each handler runs the same checks in the same order and changes state only after all of them pass:
--   1. RateLimit.consume
--   2. finiteness and Instance checks Blink cannot make (Validate)
--   3. context checks: item under workspace.Pickups, not owned by another player, a living character within
--      PICKUP_RANGE, a slot that holds an item
--   4. the side effect
-- A failed check calls Rejections.record with "<Event>.<check>" and returns, so the player sees nothing.
--
-- Reasons: RequestPickup.rateLimited, .outsideItems, .ownedByOther, .notAlive, .tooFar, .inventoryFull;
-- DropItem.rateLimited, .notFinite, .emptySlot, .notAlive, .tooFar; GetInventory.rateLimited.
--
-- Handlers never yield, so one handler call finishes before the next starts and a check cannot go stale
-- between its test and the side effect. Keep it that way: a yield before the side effect needs the checks rerun.

local Players = game:GetService("Players")
local ServerScriptService = game:GetService("ServerScriptService")

local Network = require(ServerScriptService.Network)
local RateLimit = require(script.Parent.RateLimit)
local Rejections = require(script.Parent.Rejections)
local Validate = require(script.Parent.Validate)

local PICKUP_RANGE = 12 -- studs from the character to the item or drop position
local SLOT_COUNT = 8 -- must match the `Slot: u8(1..8)` range in network/game.blink
local DROP_SIZE = 2

local Pickups = {}

-- slot number to item name, one table per player, cleared on PlayerRemoving
local inventories: { [Player]: { [number]: string } } = {}

local function trackPlayer(player: Player)
	inventories[player] = {}
end

local function pickupsFolder(): Instance?
	return workspace:FindFirstChild("Pickups")
end

-- The character's position, or nil when the player has no living character.
local function livingCharacterPosition(player: Player): Vector3?
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

local function countItems(items: { [number]: string }): number
	local count = 0
	for _ in items do
		count += 1
	end
	return count
end

local function firstFreeSlot(items: { [number]: string }): number?
	for slot = 1, SLOT_COUNT do
		if items[slot] == nil then
			return slot
		end
	end
	return nil
end

function Pickups.requestPickup(player: Player, data: { Item: Model })
	if not RateLimit.consume(player, "RequestPickup") then
		Rejections.record(player, "RequestPickup.rateLimited")
		return
	end
	local items = inventories[player]
	if items == nil then
		return
	end

	local item = data.Item
	local folder = pickupsFolder()
	if folder == nil then
		-- A server misconfiguration, not something the client did: fail loudly and keep it out of the counts.
		error("workspace.Pickups is missing")
	end
	if not Validate.isInstanceWithin(item, folder) then
		Rejections.record(player, "RequestPickup.outsideItems")
		return
	end
	local owner = item:GetAttribute("OwnerUserId")
	if owner ~= nil and owner ~= player.UserId then
		Rejections.record(player, "RequestPickup.ownedByOther")
		return
	end
	local characterPosition = livingCharacterPosition(player)
	if characterPosition == nil then
		Rejections.record(player, "RequestPickup.notAlive")
		return
	end
	if (item:GetPivot().Position - characterPosition).Magnitude > PICKUP_RANGE then
		Rejections.record(player, "RequestPickup.tooFar")
		return
	end
	local slot = firstFreeSlot(items)
	if slot == nil then
		Rejections.record(player, "RequestPickup.inventoryFull")
		return
	end

	items[slot] = item.Name
	local position = item:GetPivot().Position
	item:Destroy()
	Network.PickupEffect.FireAll(position)
end

function Pickups.dropItem(player: Player, data: { Slot: number, Position: Vector3 })
	if not RateLimit.consume(player, "DropItem") then
		Rejections.record(player, "DropItem.rateLimited")
		return
	end
	local items = inventories[player]
	if items == nil then
		return
	end

	-- Blink bounds Slot to 1..8 but leaves Position unbounded, so a client can send NaN or infinity.
	if not Validate.isFiniteVector3(data.Position) then
		Rejections.record(player, "DropItem.notFinite")
		return
	end
	local itemName = items[data.Slot]
	if itemName == nil then
		Rejections.record(player, "DropItem.emptySlot")
		return
	end
	local characterPosition = livingCharacterPosition(player)
	if characterPosition == nil then
		Rejections.record(player, "DropItem.notAlive")
		return
	end
	if (data.Position - characterPosition).Magnitude > PICKUP_RANGE then
		Rejections.record(player, "DropItem.tooFar")
		return
	end
	local folder = pickupsFolder()
	if folder == nil then
		error("workspace.Pickups is missing")
	end

	items[data.Slot] = nil
	local model = Instance.new("Model")
	model.Name = itemName
	local part = Instance.new("Part")
	part.Size = Vector3.one * DROP_SIZE
	part.Anchored = true
	part.Position = data.Position
	part.Parent = model
	model.PrimaryPart = part
	model.Parent = folder
	Network.PickupEffect.FireAll(data.Position)
end

-- How many slots hold an item; the reply to the GetInventory function. A rate-limited call gets nil.
function Pickups.getInventory(player: Player, _: nil): number?
	if not RateLimit.consume(player, "GetInventory") then
		Rejections.record(player, "GetInventory.rateLimited")
		return nil
	end
	local items = inventories[player]
	if items == nil then
		return nil
	end
	return countItems(items)
end

-- Returns a copy of one player's slots, empty for an untracked player. For server code and checks only.
function Pickups.getItems(player: Player): { [number]: string }
	local copy = {}
	local items = inventories[player]
	if items == nil then
		return copy
	end
	for slot, itemName in items do
		copy[slot] = itemName
	end
	return copy
end

-- Tracks every current and future player and clears each one on PlayerRemoving. Call once.
function Pickups.start()
	Players.PlayerAdded:Connect(trackPlayer)
	for _, player in Players:GetPlayers() do
		trackPlayer(player)
	end
	Players.PlayerRemoving:Connect(function(player: Player)
		inventories[player] = nil
	end)
end

return Pickups
