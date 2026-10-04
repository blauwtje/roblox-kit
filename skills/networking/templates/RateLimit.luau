--!strict
-- Per-player, per-event token bucket, after the token-bucket example in Roblox's client-server-boundary guide.
-- Put this ModuleScript next to Rejections and Validate (it requires Validate) in ServerScriptService. Call RateLimit.start() once at
-- server start, then RateLimit.configure with one limit per `From: Client` event in network/game.blink.
--
-- Each call to RateLimit.consume takes one token from the player's bucket for that event. A bucket starts full
-- and refills continuously, so a burst up to `capacity` passes and the long-run rate is `refillPerSecond`.
-- A player who is not tracked (a call that arrives after PlayerRemoving) gets false, so a leaving player's late
-- packets never recreate a bucket.

local Players = game:GetService("Players")

local Validate = require(script.Parent.Validate)

export type Limit = {
	capacity: number,
	refillPerSecond: number,
}

type Bucket = {
	tokens: number,
	lastRefill: number,
}

local RateLimit = {}

local limits: { [string]: Limit } = {}
local playerBuckets: { [Player]: { [string]: Bucket } } = {}

local function trackPlayer(player: Player)
	playerBuckets[player] = {}
end

-- Replaces all limits; keys are event names from game.blink. Throws on a limit that cannot work, because
-- that is a setup mistake and should fail at server start rather than silently pass or block every call.
function RateLimit.configure(newLimits: { [string]: Limit })
	for eventName, limit in newLimits do
		local capacityIsValid = limit.capacity >= 1 and Validate.isFiniteNumber(limit.capacity)
		local refillIsValid = limit.refillPerSecond >= 0 and Validate.isFiniteNumber(limit.refillPerSecond)
		if not (capacityIsValid and refillIsValid) then
			error(
				`RateLimit limit for "{eventName}" needs a finite capacity of at least 1 and a finite refillPerSecond of at least 0.`
			)
		end
	end
	limits = newLimits
end

-- Takes one token for this player and event. Returns false when the bucket is empty or the player is not
-- tracked; the caller then drops the call silently and records a reason with Rejections.record.
function RateLimit.consume(player: Player, eventName: string): boolean
	local limit = limits[eventName]
	if limit == nil then
		error(`RateLimit has no limit for "{eventName}"; add it to RateLimit.configure.`)
	end
	local buckets = playerBuckets[player]
	if buckets == nil then
		return false
	end

	local now = os.clock()
	local bucket = buckets[eventName]
	if bucket == nil then
		bucket = { tokens = limit.capacity, lastRefill = now }
		buckets[eventName] = bucket
	end

	local refilled = bucket.tokens + (now - bucket.lastRefill) * limit.refillPerSecond
	bucket.tokens = math.min(limit.capacity, refilled)
	bucket.lastRefill = now
	if bucket.tokens < 1 then
		return false
	end
	bucket.tokens -= 1
	return true
end

-- Tracks every current and future player and clears each one on PlayerRemoving. Call once.
function RateLimit.start()
	Players.PlayerAdded:Connect(trackPlayer)
	for _, player in Players:GetPlayers() do
		trackPlayer(player)
	end
	Players.PlayerRemoving:Connect(function(player: Player)
		playerBuckets[player] = nil
	end)
end

return RateLimit
