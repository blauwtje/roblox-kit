--!strict
-- Server half of a roblox-kit playtest. Put it in a Script under ServerScriptService before the test.
-- The plugin starts the test with args `{ expectedClients = number, timeoutSeconds = number }`
-- (0 clients for a Run session). The harness ends the test with a JSON string:
-- `{ peers = { { peer, checks = { { name, passed, detail } } } }, errors = { string } }`
-- where the first peer is "server" and each client that reported follows under its player name.
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StudioTestService = game:GetService("StudioTestService")

type CheckResult = { name: string, passed: boolean, detail: string }
type PeerReport = { peer: string, checks: { CheckResult } }
type Settings = { expectedClients: number, timeoutSeconds: number }
type Recorder = (name: string, passed: boolean, detail: string?) -> ()

-- Must equal the name in playtest-client-harness.luau.
local REPORT_EVENT_NAME = "RobloxKitPlaytestReport"
local POLL_SECONDS = 0.1

-- The spliced body sees `check(name, passed, detail)` to record a result and `expectedClients`.
-- selene: allow(unused_variable)
local function runChecks(check: Recorder, expectedClients: number): ...any
	-- roblox-kit:check-body
end

local function endTest(peers: { PeerReport }, errors: { string })
	StudioTestService:EndTest(HttpService:JSONEncode({ peers = peers, errors = errors }))
end

local function readSettings(): Settings?
	local arguments: any = StudioTestService:GetTestArgs()
	if
		typeof(arguments) ~= "table"
		or typeof(arguments.expectedClients) ~= "number"
		or typeof(arguments.timeoutSeconds) ~= "number"
	then
		return nil
	end
	return { expectedClients = arguments.expectedClients, timeoutSeconds = arguments.timeoutSeconds }
end

-- Keeps the entries of a client's report that have the CheckResult shape; the client is not trusted.
local function readClientChecks(raw: unknown): { CheckResult }
	local checks: { CheckResult } = {}
	if typeof(raw) ~= "table" then
		return checks
	end
	for _, entry: any in raw :: { any } do
		if
			typeof(entry) == "table"
			and typeof(entry.name) == "string"
			and typeof(entry.passed) == "boolean"
			and typeof(entry.detail) == "string"
		then
			table.insert(checks, { name = entry.name, passed = entry.passed, detail = entry.detail })
		end
	end
	return checks
end

local function runServerChecks(expectedClients: number): PeerReport
	local checks: { CheckResult } = {}
	local function check(name: string, passed: boolean, detail: string?)
		table.insert(checks, { name = name, passed = passed, detail = detail or "" })
	end
	local succeeded, message = pcall(runChecks, check, expectedClients)
	if not succeeded then
		check("server checks ran to the end", false, tostring(message))
	end
	return { peer = "server", checks = checks }
end

local settings = readSettings()
if settings == nil then
	endTest({}, { "GetTestArgs did not return { expectedClients, timeoutSeconds }; start the test with those args." })
	return
end

local reportEvent = Instance.new("RemoteEvent")
reportEvent.Name = REPORT_EVENT_NAME
reportEvent.Parent = ReplicatedStorage

local clientPeers: { PeerReport } = {}
local reportedPlayers: { [Player]: boolean } = {}
reportEvent.OnServerEvent:Connect(function(player: Player, rawChecks: unknown)
	if reportedPlayers[player] then
		return
	end
	reportedPlayers[player] = true
	table.insert(clientPeers, { peer = player.Name, checks = readClientChecks(rawChecks) })
end)

local deadline = os.clock() + settings.timeoutSeconds
local outcome: { server: PeerReport? } = { server = nil }
task.spawn(function()
	outcome.server = runServerChecks(settings.expectedClients)
end)
while (outcome.server == nil or #clientPeers < settings.expectedClients) and os.clock() < deadline do
	task.wait(POLL_SECONDS)
end

local peers: { PeerReport } = {}
local errors: { string } = {}
if outcome.server == nil then
	table.insert(errors, `server checks did not finish within {settings.timeoutSeconds} s`)
else
	table.insert(peers, outcome.server)
end
for _, clientPeer in clientPeers do
	table.insert(peers, clientPeer)
end
if #clientPeers < settings.expectedClients then
	table.insert(
		errors,
		`{#clientPeers} of {settings.expectedClients} clients reported within {settings.timeoutSeconds} s ({#Players:GetPlayers()} joined)`
	)
end

reportEvent:Destroy()
endTest(peers, errors)
