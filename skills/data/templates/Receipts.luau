--!strict
-- Developer product receipts with ProfileStore. Put this ModuleScript next to PlayerData and Main.server in
-- ServerScriptService, and call Receipts.start() once from one server script.
--
-- Payment rules this follows:
-- - ProcessReceipt is set once, here. It also receives Store tab purchases made outside the experience.
-- - It has no time-based retry: after NotProcessedYet it runs again only when the player starts another
--   purchase or rejoins any server. It has no timeout, and unresolved purchases are never refunded.
-- - It can run on two servers at once, and a returned PurchaseGranted can fail to record and run again.
--   The PurchaseId cache in the profile makes a rerun grant nothing twice.
-- - The reward and the PurchaseId are written to Profile.Data together, and PurchaseGranted is returned
--   only once the id is in Profile.LastSavedData, so a granted purchase has reached the DataStore.
-- - Game passes never go through ProcessReceipt; see GamePasses.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")

local PlayerData = require(script.Parent.PlayerData)

local PURCHASE_ID_CACHE_SIZE = 100
local SAVE_RECHECK_SECONDS = 10

export type ReceiptInfo = {
	PurchaseId: string,
	PlayerId: number,
	ProductId: number,
	CurrencySpent: number,
	CurrencyType: Enum.CurrencyType,
	PlaceIdWherePurchased: number,
}
-- Grants the reward by changing profile.Data (and the game world). Throw to refuse: the purchase stays
-- unprocessed and is retried. Do not call profile:Save() here; the receipt code saves and waits.
export type ProductHandler = (receiptInfo: ReceiptInfo, player: Player, profile: PlayerData.Profile) -> ()

local Receipts = {}

-- ADAPT: one entry per developer product, keyed by ProductId. Example for a "Cash" field you add to PlayerData:
-- [123456] = function(_receiptInfo, _player, profile)
-- 	profile.Data.Cash += 100
-- end,
Receipts.productHandlers = {} :: { [number]: ProductHandler }

local function isPurchaseSaved(profile: PlayerData.Profile, purchaseId: string): boolean
	local savedCache = profile.LastSavedData.PurchaseIdCache
	return table.find(savedCache, purchaseId) ~= nil
end

-- Yields until the profile's next save finishes. ProfileStore's Profile type gives its signals only Connect.
local function waitForSave(profile: PlayerData.Profile)
	local thread = coroutine.running()
	local connection
	connection = profile.OnAfterSave:Connect(function()
		connection:Disconnect()
		task.spawn(thread)
	end)
	coroutine.yield()
end

-- Grants the product unless its PurchaseId is already recorded, then waits until the id is saved or the
-- session ends. Yields for as long as saving takes, which ProcessReceipt allows.
local function grantAndWaitForSave(
	profile: PlayerData.Profile,
	player: Player,
	receiptInfo: ReceiptInfo,
	handler: ProductHandler
): Enum.ProductPurchaseDecision
	local purchaseIdCache = profile.Data.PurchaseIdCache
	local purchaseId = receiptInfo.PurchaseId

	if table.find(purchaseIdCache, purchaseId) == nil then
		-- The handler returns nothing, so pcall's type omits the error value; annotating declares it.
		local success: boolean, result: unknown = pcall(handler, receiptInfo, player, profile)
		if not success then
			warn(`Failed to process receipt {purchaseId} for {profile.Key}: {result}`)
			return Enum.ProductPurchaseDecision.NotProcessedYet
		end
		while #purchaseIdCache >= PURCHASE_ID_CACHE_SIZE do
			table.remove(purchaseIdCache, 1)
		end
		table.insert(purchaseIdCache, purchaseId)
	end

	if isPurchaseSaved(profile, purchaseId) then
		return Enum.ProductPurchaseDecision.PurchaseGranted
	end

	while profile:IsActive() do
		local lastSavedData = profile.LastSavedData
		profile:Save()
		-- Save can finish before it returns; only wait when nothing was saved yet.
		if profile.LastSavedData == lastSavedData then
			waitForSave(profile)
		end
		if isPurchaseSaved(profile, purchaseId) then
			return Enum.ProductPurchaseDecision.PurchaseGranted
		end
		if profile:IsActive() then
			task.wait(SAVE_RECHECK_SECONDS)
		end
	end

	-- The session ended before the id was saved: ask Roblox to run the receipt again later.
	return Enum.ProductPurchaseDecision.NotProcessedYet
end

function Receipts.processReceipt(receiptInfo: ReceiptInfo): Enum.ProductPurchaseDecision
	local player = Players:GetPlayerByUserId(receiptInfo.PlayerId)
	if player == nil then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	local profile = PlayerData.get(player)
	if profile == nil or not profile:IsActive() then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	local handler = Receipts.productHandlers[receiptInfo.ProductId]
	if handler == nil then
		-- Never grant an unknown product. Add its handler, then the receipt runs again on rejoin.
		warn(`No handler for product {receiptInfo.ProductId} in receipt {receiptInfo.PurchaseId}`)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	return grantAndWaitForSave(profile, player, receiptInfo, handler)
end

-- Sets MarketplaceService.ProcessReceipt. It may be set only once, by one server script.
function Receipts.start()
	MarketplaceService.ProcessReceipt = Receipts.processReceipt
end

return Receipts
