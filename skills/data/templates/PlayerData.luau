--!strict
-- Player data with ProfileStore. Put this ModuleScript next to Receipts and Main.server in ServerScriptService.
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ServerScriptService = game:GetService("ServerScriptService")

-- ADAPT: the path where Wally places ProfileStore (lm-loleris/profilestore under [server-dependencies]).
local ProfileStore = require(ServerScriptService.ServerPackages.ProfileStore)

local STORE_NAME = "PlayerData"
local KICK_LOAD_FAILED = "Profile load fail - Please rejoin"
local KICK_SESSION_ENDED = "Profile session end - Please rejoin"
local KICK_NEWER_DATA = "Your data was saved by a newer version of this game - Please rejoin"

export type Data = {
	DataVersion: number,
	PurchaseIdCache: { string },
}
export type Profile = ProfileStore.Profile<Data>
type Migration = (data: { [string]: any }) -> ()

-- Entry n upgrades version n - 1 to n and may be run on a fresh profile (version 0), so it must
-- tolerate missing fields. Never edit or reorder a shipped entry: append a new one instead.
local migrations: { Migration } = {
	function(_data)
		-- Version 0 is data saved before DataVersion existed. Nothing to change yet.
	end,
}
local CURRENT_VERSION = #migrations

-- Profile.Data starts as a copy of this. Reconcile fills keys missing from older profiles; it is not migration.
-- Typed as Data so the store's profiles carry Data rather than the template's inferred table type.
local template: Data = {
	DataVersion = CURRENT_VERSION,
	PurchaseIdCache = {},
}

local baseStore = ProfileStore.New(STORE_NAME, template)
-- Studio never touches live keys: the mock store keeps data in memory only.
local store = if RunService:IsStudio() then baseStore.Mock else baseStore

local profiles: { [Player]: Profile } = {}

local PlayerData = {}

PlayerData.store = store

function PlayerData.get(player: Player): Profile?
	return profiles[player]
end

-- Starts a session on the store; start every session through this. ProfileStore types Profile.Data as
-- `T & JSONAcceptable`, and the type checker never matches two separately built Profile<Data> types, so
-- the store's result is cast once here, through any, to the exported Profile.
function PlayerData.startSession(profileKey: string, cancel: (() -> boolean)?): Profile?
	local profile = store:StartSessionAsync(profileKey, { Cancel = cancel })
	return profile :: any
end

local function readVersion(data: { [string]: any }): number
	local version = data.DataVersion
	if type(version) == "number" then
		return version
	end
	return 0
end

local function deepCopy(value: any): any
	if type(value) ~= "table" then
		return value
	end
	local copy = {}
	for key, child in value do
		copy[key] = deepCopy(child)
	end
	return copy
end

-- Runs every migration after the data's version, in order, directly on data.
function PlayerData.migrate(data: { [string]: any })
	for version = readVersion(data) + 1, CURRENT_VERSION do
		migrations[version](data)
		data.DataVersion = version
	end
end

-- Version gate, migrations, then Reconcile on a started profile. Returns false when the profile
-- must not be used, after ending its session with its stored data untouched.
function PlayerData.prepare(profile: Profile): boolean
	local data: { [string]: any } = profile.Data :: any
	if readVersion(data) > CURRENT_VERSION then
		-- An old server in a rolling update: never migrate, reconcile or write over fields it does not know.
		profile:EndSession()
		return false
	end

	-- Migrate a copy so a migration that throws cannot leave profile.Data half migrated and then saved.
	local migrated = deepCopy(data)
	-- migrate returns nothing, so pcall's type omits the error value; annotating declares it.
	local ok: boolean, message: unknown = pcall(PlayerData.migrate, migrated)
	if not ok then
		warn(`Migration failed for profile {profile.Key}: {message}`)
		profile:EndSession()
		return false
	end
	table.clear(data)
	for key, value in migrated do
		data[key] = value
	end

	profile:Reconcile()
	return true
end

local function onPlayerAdded(player: Player)
	-- Once IsClosing is true most ProfileStore methods silently fail, so never start a session then.
	if ProfileStore.IsClosing then
		player:Kick(KICK_LOAD_FAILED)
		return
	end

	local profile = PlayerData.startSession(tostring(player.UserId), function()
		return player.Parent ~= Players
	end)
	if profile == nil then
		player:Kick(KICK_LOAD_FAILED)
		return
	end

	-- The player left while the session was loading.
	if player.Parent ~= Players then
		profile:EndSession()
		return
	end

	if not PlayerData.prepare(profile) then
		player:Kick(KICK_NEWER_DATA)
		return
	end

	profile:AddUserId(player.UserId) -- Lets Roblox GDPR erasure requests find this profile.
	profile.OnSessionEnd:Connect(function()
		profiles[player] = nil
		player:Kick(KICK_SESSION_ENDED)
	end)
	profiles[player] = profile
end

local function onPlayerRemoving(player: Player)
	-- Ending the session saves the profile. Do not add an own BindToClose: ProfileStore ends and saves every active profile.
	local profile = profiles[player]
	if profile ~= nil then
		profile:EndSession()
	end
end

function PlayerData.start()
	Players.PlayerAdded:Connect(onPlayerAdded)
	Players.PlayerRemoving:Connect(onPlayerRemoving)
	for _, player in Players:GetPlayers() do
		task.spawn(onPlayerAdded, player)
	end
end

return PlayerData
