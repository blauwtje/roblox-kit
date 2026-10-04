--!strict
-- Client half of the networking bad-data playtest. Put this ModuleScript in ReplicatedStorage next to the
-- generated Blink client (ReplicatedStorage.Network) and run it as the clientChecks body
-- `require(game.ReplicatedStorage.NetworkClientChecks)(check, player)`, with NetworkChecks as the server checks.
--
-- It waits for the fixture names NetworkChecks sends in a player attribute, then for the fixtures themselves, then sends bad data, one send per frame so a Blink decode error
-- (which drops the rest of that batch) cannot swallow a later send:
--   * wrong-class Instances, out-of-range slots, NaN and infinite positions, through Blink's generated client,
--     which does not validate on write (WriteValidations defaults to false);
--   * another player's item, a far item and an item outside workspace.Pickups, which only game code can judge;
--   * raw non-buffer and truncated-buffer payloads straight to BLINK_RELIABLE_REMOTE, which the generated server
--     reads as (buffer, {Instance}); this ties the truncated payloads to the Blink 0.18.9 wire format (event index
--     byte 0 is RequestPickup, 1 is DropItem), so rerun this check before bumping Blink;
--   * a flood of DropItem past the rate limit, in one frame.
-- The last send is one valid pickup, the end marker the server waits for.

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Network = require(ReplicatedStorage.Network)

type Check = (name: string, passed: boolean, detail: string?) -> ()

type Fixtures = {
	names: { valid: string, far: string, foreign: string, notModel: string, outside: string },
	floodSize: number,
}

local FIXTURE_WAIT_SECONDS = 30
local REMOTE_WAIT_SECONDS = 10
local INVENTORY_WAIT_SECONDS = 10
local FIXTURE_ATTRIBUTE = "NetworkFixtures" -- set by NetworkChecks: JSON of the fixture names and flood size
local DROP_INDEX = 1 -- Blink 0.18.9 event index byte of DropItem in network/game.blink
local REQUEST_INDEX = 0 -- Blink 0.18.9 event index byte of RequestPickup

-- The names and flood size NetworkChecks defines, or nil when it does not send them in time.
local function waitForFixtures(player: Player): Fixtures?
	local deadline = os.clock() + FIXTURE_WAIT_SECONDS
	while os.clock() < deadline do
		local encoded = player:GetAttribute(FIXTURE_ATTRIBUTE)
		if typeof(encoded) == "string" then
			return HttpService:JSONDecode(encoded)
		end
		task.wait(0.1)
	end
	return nil
end

local function waitForFixture(parent: Instance, name: string): Instance?
	return parent:WaitForChild(name, FIXTURE_WAIT_SECONDS)
end

-- Sends one thing, flushes Blink's queue so it leaves in this frame as its own batch, then waits one frame.
local function sendInOwnFrame(check: Check, label: string, send: () -> ())
	local sent, message = pcall(send :: () -> any)
	check(`sent {label}`, sent, if sent then nil else tostring(message))
	Network.StepReplication()
	task.wait()
end

-- The reply to GetInventory, or nil when none arrives in time; Invoke yields until the server answers.
local function inventoryCount(): number?
	local count: number? = nil
	local answered = false
	task.spawn(function()
		count = Network.GetInventory.Invoke(nil)
		answered = true
	end)
	local deadline = os.clock() + INVENTORY_WAIT_SECONDS
	while not answered and os.clock() < deadline do
		task.wait(0.1)
	end
	return count
end

return function(check: Check, player: Player)
	local pickups = workspace:WaitForChild("Pickups", FIXTURE_WAIT_SECONDS)
	local remote = ReplicatedStorage:WaitForChild("BLINK_RELIABLE_REMOTE", REMOTE_WAIT_SECONDS)
	if pickups == nil or remote == nil or not remote:IsA("RemoteEvent") then
		check("the pickups folder and Blink remote exist", false, `pickups: {pickups}, remote: {remote}`)
		return
	end

	local fixtures = waitForFixtures(player)
	if fixtures == nil then
		check("the fixture names arrived", false, `no {FIXTURE_ATTRIBUTE} attribute after the wait`)
		return
	end
	local names = fixtures.names
	local valid = waitForFixture(pickups, names.valid)
	local far = waitForFixture(pickups, names.far)
	local foreign = waitForFixture(pickups, names.foreign)
	local notModel = waitForFixture(pickups, names.notModel)
	local outside = waitForFixture(workspace, names.outside)
	if valid == nil or far == nil or foreign == nil or notModel == nil or outside == nil then
		check("all fixtures replicated", false, "a fixture is missing after the wait")
		return
	end
	check("all fixtures replicated", true)

	local character = player.Character or player.CharacterAdded:Wait()
	local origin = character:GetPivot().Position
	local notANumber = math.huge - math.huge
	local anyModel = function(instance: Instance): Model
		return instance :: any
	end

	-- Wrong Instance classes: Blink's read function rejects them before game code runs. Workspace would pass,
	-- because it inherits from Model, so the second case is the Pickups Folder.
	sendInOwnFrame(check, "a Part as the item", function()
		Network.RequestPickup.Fire({ Item = anyModel(notModel) })
	end)
	sendInOwnFrame(check, "a Folder as the item", function()
		Network.RequestPickup.Fire({ Item = anyModel(pickups) })
	end)

	-- Out-of-range slots: Blink bounds Slot to 1..8. They go out while the inventory is empty, so NetworkChecks
	-- observes them through the DropItem rejection total: a slot Blink let through would be one rejection too many.
	for _, slot in { 0, 9, 255 } do
		sendInOwnFrame(check, `slot {slot}`, function()
			Network.DropItem.Fire({ Slot = slot, Position = origin })
		end)
	end

	-- Positions Blink's unbounded `vector` lets through; the server's Validate rejects them.
	sendInOwnFrame(check, "a NaN position", function()
		Network.DropItem.Fire({ Slot = 1, Position = Vector3.new(notANumber, origin.Y, origin.Z) })
	end)
	sendInOwnFrame(check, "an infinite position", function()
		Network.DropItem.Fire({ Slot = 1, Position = Vector3.new(origin.X, math.huge, origin.Z) })
	end)

	-- Context only game code can judge.
	sendInOwnFrame(check, "another player's item", function()
		Network.RequestPickup.Fire({ Item = anyModel(foreign) })
	end)
	sendInOwnFrame(check, "a far item", function()
		Network.RequestPickup.Fire({ Item = anyModel(far) })
	end)
	sendInOwnFrame(check, "an item outside workspace.Pickups", function()
		Network.RequestPickup.Fire({ Item = anyModel(outside) })
	end)

	-- Raw payloads that bypass Blink's client.
	sendInOwnFrame(check, "a string instead of a buffer", function()
		remote:FireServer("not a buffer", {})
	end)
	sendInOwnFrame(check, "a number instead of a buffer", function()
		remote:FireServer(42, {})
	end)
	sendInOwnFrame(check, "a table instead of a buffer", function()
		remote:FireServer({}, {})
	end)
	sendInOwnFrame(check, "no arguments", function()
		remote:FireServer()
	end)
	sendInOwnFrame(check, "a buffer with a non-table instance list", function()
		local payload = buffer.create(1)
		buffer.writeu8(payload, 0, REQUEST_INDEX)
		remote:FireServer(payload, "not a table")
	end)
	sendInOwnFrame(check, "a RequestPickup with no instance", function()
		local payload = buffer.create(1)
		buffer.writeu8(payload, 0, REQUEST_INDEX)
		remote:FireServer(payload, {})
	end)
	sendInOwnFrame(check, "a DropItem cut short", function()
		local payload = buffer.create(4)
		buffer.writeu8(payload, 0, DROP_INDEX)
		remote:FireServer(payload, {})
	end)

	-- A flood in one frame: DropItem of an empty slot, so nothing changes whether a call is judged or limited.
	sendInOwnFrame(check, `a flood of {fixtures.floodSize} DropItem calls`, function()
		for _ = 1, fixtures.floodSize do
			Network.DropItem.Fire({ Slot = 1, Position = origin })
		end
	end)

	-- The end marker: one valid pickup after every bad send.
	sendInOwnFrame(check, "the final valid pickup", function()
		Network.RequestPickup.Fire({ Item = anyModel(valid) })
	end)
	local count = inventoryCount()
	check("the server reports one item after the valid pickup", count == 1, `count: {count}`)
end
