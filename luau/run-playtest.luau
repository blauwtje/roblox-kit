--!strict
-- Runs one StudioTestService session for run_playtest, or removes the harness scripts it inserted.
-- Returns a JSON string: { ended = boolean, report = the JSON string of the server harness decoded }.
type Arguments = {
	action: "run" | "cleanup",
	mode: "run" | "play" | "multiplayer",
	players: number,
	expectedClients: number,
	timeoutSeconds: number,
	serverSource: string,
	clientSource: string,
}

-- Names of the two harness scripts; cleanup finds them by these.
local SERVER_HARNESS_NAME = "RobloxKitPlaytestServerHarness"
local CLIENT_HARNESS_NAME = "RobloxKitPlaytestClientHarness"

local arguments: Arguments = ...
local HttpService = game:GetService("HttpService")
local ServerScriptService = game:GetService("ServerScriptService")
local StarterPlayer = game:GetService("StarterPlayer")
local StudioTestService = game:GetService("StudioTestService")

local function removeNamed(container: Instance, name: string)
	for _, child in container:GetChildren() do
		if child.Name == name then
			child:Destroy()
		end
	end
end

local function starterPlayerScripts(): Instance
	local scripts = StarterPlayer:FindFirstChildOfClass("StarterPlayerScripts")
	if scripts == nil then
		error("StarterPlayer has no StarterPlayerScripts folder in this place.", 0)
	end
	return scripts
end

local function removeHarness(): ...any
	removeNamed(ServerScriptService, SERVER_HARNESS_NAME)
	removeNamed(starterPlayerScripts(), CLIENT_HARNESS_NAME)
end

local function insertHarness(): ...any
	local serverScript = Instance.new("Script")
	serverScript.Name = SERVER_HARNESS_NAME
	serverScript.Source = arguments.serverSource
	serverScript.Parent = ServerScriptService
	if arguments.expectedClients > 0 then
		local clientScript = Instance.new("LocalScript")
		clientScript.Name = CLIENT_HARNESS_NAME
		clientScript.Source = arguments.clientSource
		clientScript.Parent = starterPlayerScripts()
	end
end

-- Yields until the server harness calls EndTest; returns nil when the test ended by other means.
local function executeTest(): any
	local testArguments = { expectedClients = arguments.expectedClients, timeoutSeconds = arguments.timeoutSeconds }
	if arguments.mode == "run" then
		return StudioTestService:ExecuteRunModeAsync(testArguments)
	elseif arguments.mode == "play" then
		return StudioTestService:ExecutePlayModeAsync(testArguments)
	end
	return StudioTestService:ExecuteMultiplayerTestAsync(arguments.players, testArguments)
end

if arguments.action == "cleanup" then
	removeHarness()
	return HttpService:JSONEncode({ ended = false })
end

removeHarness()
local inserted, insertFailure = pcall(insertHarness)
local executed, outcome = false, nil :: any
if inserted then
	executed, outcome = pcall(executeTest)
end
local removed, removeFailure = pcall(removeHarness)
if not inserted then
	error(`Could not insert the harness scripts: {insertFailure}`, 0)
end
if not executed then
	error(`StudioTestService could not run the test: {outcome}`, 0)
end
if not removed then
	error(`The test ran but the harness scripts were not removed: {removeFailure}`, 0)
end
if typeof(outcome) ~= "string" then
	return HttpService:JSONEncode({ ended = false })
end
return HttpService:JSONEncode({ ended = true, report = HttpService:JSONDecode(outcome) })
