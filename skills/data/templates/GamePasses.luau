--!strict
-- Game pass ownership for a Rojo game. Game passes never go through ProcessReceipt; only developer
-- products do. Call GamePasses.start() once from one server script.
--
-- Results from UserOwnsGamePassAsync are cached by Roblox, so a pass bought outside the experience
-- during a session can take minutes to show. A pass bought in the session is recorded here from
-- PromptGamePassPurchaseFinished.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")

local GamePasses = {}

-- Player to pass id to ownership. A missing pass id has not been looked up yet.
local ownership: { [Player]: { [number]: boolean } } = {}

local function lookUp(player: Player, passId: number): boolean?
	local success, result = pcall(function()
		return MarketplaceService:UserOwnsGamePassAsync(player.UserId, passId)
	end)
	if not success then
		warn(`UserOwnsGamePassAsync failed for {player.UserId} and pass {passId}: {result}`)
		return nil
	end
	return result
end

-- Returns whether the player owns the pass. Returns false when the lookup fails and does not cache
-- the failure, so the next call tries again.
function GamePasses.owns(player: Player, passId: number): boolean
	local passes = ownership[player]
	if passes == nil then
		return false
	end
	local cached = passes[passId]
	if cached ~= nil then
		return cached
	end
	local owned = lookUp(player, passId)
	if owned == nil then
		return false
	end
	-- The player may have left, or bought the pass, during the yield above.
	if ownership[player] ~= passes then
		return owned
	end
	if passes[passId] == nil then
		passes[passId] = owned
	end
	return passes[passId] :: boolean
end

function GamePasses.start()
	local function onPlayerAdded(player: Player)
		ownership[player] = {}
	end

	Players.PlayerAdded:Connect(onPlayerAdded)
	for _, player in Players:GetPlayers() do
		onPlayerAdded(player)
	end

	Players.PlayerRemoving:Connect(function(player: Player)
		ownership[player] = nil
	end)

	MarketplaceService.PromptGamePassPurchaseFinished:Connect(
		function(player: Player, passId: number, wasPurchased: boolean)
			if not wasPurchased then
				return
			end
			local passes = ownership[player]
			if passes ~= nil then
				passes[passId] = true
			end
		end
	)
end

return GamePasses
