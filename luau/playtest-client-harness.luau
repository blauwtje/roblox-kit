--!strict
-- Client half of a roblox-kit playtest. Put it in a LocalScript under StarterPlayer.StarterPlayerScripts
-- before the test. It runs the spliced checks once, then sends `{ { name, passed, detail } }` to the
-- server harness, which files it under this player's name. GetTestArgs is not read here because the
-- documented known issue makes it unreliable in a LocalScript.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

type CheckResult = { name: string, passed: boolean, detail: string }
type Recorder = (name: string, passed: boolean, detail: string?) -> ()

-- Must equal the name in playtest-server-harness.luau.
local REPORT_EVENT_NAME = "RobloxKitPlaytestReport"
local REPORT_EVENT_WAIT_SECONDS = 30

-- The spliced body sees `check(name, passed, detail)` to record a result and this client's `player`.
-- selene: allow(unused_variable)
local function runChecks(check: Recorder, player: Player)
	-- roblox-kit:check-body
end

if not game:IsLoaded() then
	game.Loaded:Wait()
end

local checks: { CheckResult } = {}
local function check(name: string, passed: boolean, detail: string?)
	table.insert(checks, { name = name, passed = passed, detail = detail or "" })
end

local succeeded, message = pcall(runChecks, check, Players.LocalPlayer)
if not succeeded then
	check("client checks ran to the end", false, tostring(message))
end

local reportEvent = ReplicatedStorage:WaitForChild(REPORT_EVENT_NAME, REPORT_EVENT_WAIT_SECONDS)
if reportEvent == nil or not reportEvent:IsA("RemoteEvent") then
	error(`{REPORT_EVENT_NAME} RemoteEvent never appeared in ReplicatedStorage; the server harness is not running`, 0)
end
reportEvent:FireServer(checks)
