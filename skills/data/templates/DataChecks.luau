--!strict
-- Playtest checks for the data templates. Put this ModuleScript next to PlayerData and Receipts in
-- ServerScriptService, and run it in a play-mode playtest with the server checks body
-- `require(game.ServerScriptService.DataChecks)(check, expectedClients)`.
-- It runs only in Studio, where PlayerData uses the in-memory mock store, so it never touches live keys.
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local PlayerData = require(script.Parent.PlayerData)
local Receipts = require(script.Parent.Receipts)

local TEST_PRODUCT_ID = 987654321
local VERSION_ZERO_KEY = "DataChecks-version-zero"
local NEWER_VERSION_KEY = "DataChecks-newer-version"
local NEWER_VERSION = 1000000
local PROFILE_WAIT_SECONDS = 30
local RELEASE_WAIT_SECONDS = 10

type Check = (name: string, passed: boolean, detail: string?) -> ()

local function waitForPlayerProfile(): (Player?, PlayerData.Profile?)
	local deadline = os.clock() + PROFILE_WAIT_SECONDS
	while os.clock() < deadline do
		for _, player in Players:GetPlayers() do
			local profile = PlayerData.get(player)
			if profile ~= nil then
				return player, profile
			end
		end
		task.wait(0.25)
	end
	return nil, nil
end

-- Ends the session and waits for the final save, which releases the key for a new session.
local function endSessionAndWait(profile: PlayerData.Profile): boolean
	local saved = false
	local connection = profile.OnAfterSave:Connect(function()
		saved = true
	end)
	profile:EndSession()
	local deadline = os.clock() + RELEASE_WAIT_SECONDS
	while not saved and os.clock() < deadline do
		task.wait()
	end
	connection:Disconnect()
	return saved
end

local function receiptFor(player: Player?, purchaseId: string): Receipts.ReceiptInfo
	return {
		PurchaseId = purchaseId,
		PlayerId = if player ~= nil then player.UserId else -1,
		ProductId = TEST_PRODUCT_ID,
		CurrencySpent = 0,
		CurrencyType = Enum.CurrencyType.Robux,
		PlaceIdWherePurchased = game.PlaceId,
	}
end

local function checkReceipts(check: Check, player: Player?, profile: PlayerData.Profile?)
	local grantCount = 0
	Receipts.productHandlers[TEST_PRODUCT_ID] = function()
		grantCount += 1
	end

	local unknown = Receipts.processReceipt(receiptFor(nil, "DataChecks-no-profile"))
	check(
		"receipt for a PlayerId with no loaded profile returns NotProcessedYet",
		unknown == Enum.ProductPurchaseDecision.NotProcessedYet,
		tostring(unknown)
	)

	if player == nil or profile == nil then
		check(
			"the player's profile loaded",
			false,
			`no profile after {PROFILE_WAIT_SECONDS} s; run the playtest in play mode`
		)
		Receipts.productHandlers[TEST_PRODUCT_ID] = nil
		return
	end

	local purchaseId = "DataChecks-duplicate"
	local first = Receipts.processReceipt(receiptFor(player, purchaseId))
	local second = Receipts.processReceipt(receiptFor(player, purchaseId))
	check("the same PurchaseId twice grants once", grantCount == 1, `grants: {grantCount}`)
	check(
		"both receipts return PurchaseGranted",
		first == Enum.ProductPurchaseDecision.PurchaseGranted and second == Enum.ProductPurchaseDecision.PurchaseGranted,
		`{first}, {second}`
	)
	check(
		"PurchaseGranted returns only with the id in Profile.LastSavedData.PurchaseIdCache",
		table.find(profile.LastSavedData.PurchaseIdCache, purchaseId) ~= nil,
		table.concat(profile.LastSavedData.PurchaseIdCache, ", ")
	)

	Receipts.productHandlers[TEST_PRODUCT_ID] = nil
end

local function checkVersionZero(check: Check)
	local profile = PlayerData.startSession(VERSION_ZERO_KEY)
	if profile == nil then
		check(
			"a version-0 table migrates to the current DataVersion before Reconcile",
			false,
			"the test profile did not load"
		)
		return
	end

	-- Simulate data saved before DataVersion existed, and note the version at the moment Reconcile runs.
	local data: { [string]: any } = profile.Data :: any
	data.DataVersion = nil
	local versionAtReconcile: any = "Reconcile never ran"
	local spied: any = profile
	local reconcile = spied.Reconcile
	spied.Reconcile = function(self: any)
		versionAtReconcile = data.DataVersion
		reconcile(self)
	end

	local usable = PlayerData.prepare(profile)
	local versionAfter = data.DataVersion
	check(
		"a version-0 table migrates to the current DataVersion before Reconcile",
		usable and type(versionAtReconcile) == "number" and versionAtReconcile == versionAfter and versionAfter >= 1,
		`usable: {usable}, version at Reconcile: {versionAtReconcile}, after: {versionAfter}`
	)
	endSessionAndWait(profile)
end

local function checkNewerVersion(check: Check)
	local name = "a newer DataVersion ends the session and a reload shows it unchanged"
	local seed = PlayerData.startSession(NEWER_VERSION_KEY)
	if seed == nil then
		check(name, false, "the seed profile did not load")
		return
	end
	local seedData: { [string]: any } = seed.Data :: any
	table.clear(seedData)
	seedData.DataVersion = NEWER_VERSION
	seedData.FutureField = "keep"
	if not endSessionAndWait(seed) then
		check(name, false, "the seed profile did not save")
		return
	end

	local profile = PlayerData.startSession(NEWER_VERSION_KEY)
	if profile == nil then
		check(name, false, "the newer-version profile did not load")
		return
	end
	local usable = PlayerData.prepare(profile)
	check(
		"the newer-version profile is refused and its session ends",
		not usable and not profile:IsActive(),
		`usable: {usable}, active: {profile:IsActive()}`
	)
	-- prepare ended the session; wait for its final save before loading the key again.
	task.wait(1)

	local reloaded = PlayerData.startSession(NEWER_VERSION_KEY)
	if reloaded == nil then
		check(name, false, "the reload did not load")
		return
	end
	local reloadedData: { [string]: any } = reloaded.Data :: any
	check(
		name,
		reloadedData.DataVersion == NEWER_VERSION
			and reloadedData.FutureField == "keep"
			and reloadedData.PurchaseIdCache == nil,
		`DataVersion: {reloadedData.DataVersion}, FutureField: {reloadedData.FutureField}, PurchaseIdCache: {reloadedData.PurchaseIdCache}`
	)
	endSessionAndWait(reloaded)
end

return function(check: Check, expectedClients: number)
	if not RunService:IsStudio() then
		check("DataChecks runs only in Studio", false, "outside Studio PlayerData uses live keys")
		return
	end

	local player: Player?, profile: PlayerData.Profile? = nil, nil
	if expectedClients > 0 then
		player, profile = waitForPlayerProfile()
	end
	checkReceipts(check, player, profile)
	checkVersionZero(check)
	checkNewerVersion(check)
end
