--!strict
-- Counts game-code rejections per player per reason, as data for a later anti-cheat. Put this ModuleScript next
-- to RateLimit and Validate in ServerScriptService and call Rejections.start() once at server start.
--
-- A rejected call stays silent to the player: this module never fires a remote, kicks or warns. It counts only
-- what game code rejects (rate limit, Validate checks, ownership checks). Blink's own decode rejections error
-- inside the generated OnServerEvent handler before any game code runs, so they are not counted here.
--
-- Reasons are short stable strings such as "DropItem.rateLimited" or "RequestPickup.outsideItems". A player
-- who is not tracked (a call that arrives after PlayerRemoving) is ignored, so counts never leak.

local Players = game:GetService("Players")

local Rejections = {}

local countsByPlayer: { [Player]: { [string]: number } } = {}

local function trackPlayer(player: Player)
	countsByPlayer[player] = {}
end

function Rejections.record(player: Player, reason: string)
	local counts = countsByPlayer[player]
	if counts == nil then
		return
	end
	counts[reason] = (counts[reason] or 0) + 1
end

-- Returns a copy of one player's counts by reason, empty for an untracked player.
function Rejections.get(player: Player): { [string]: number }
	local copy = {}
	local counts = countsByPlayer[player]
	if counts == nil then
		return copy
	end
	for reason, count in counts do
		copy[reason] = count
	end
	return copy
end

-- Returns how often one reason was recorded for one player.
function Rejections.count(player: Player, reason: string): number
	local counts = countsByPlayer[player]
	if counts == nil then
		return 0
	end
	return counts[reason] or 0
end

-- Tracks every current and future player and clears each one on PlayerRemoving. Call once.
function Rejections.start()
	Players.PlayerAdded:Connect(trackPlayer)
	for _, player in Players:GetPlayers() do
		trackPlayer(player)
	end
	Players.PlayerRemoving:Connect(function(player: Player)
		countsByPlayer[player] = nil
	end)
end

return Rejections
