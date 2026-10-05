--!strict
-- Runs the probe Script (`arguments.source`) once in the server of the running playtest and returns
-- `{ status = "finished", result = { ok, value | error } }` or `{ status = "timed-out" }` as JSON.
-- The Script is destroyed in every outcome. Run with datamodel_type Server.
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local ServerScriptService = game:GetService("ServerScriptService")

type Arguments = { source: string, timeoutSeconds: number }
local arguments: Arguments = ...

local PROBE_NAME = "RobloxKitPlaytestProbe"
-- Must equal the name in playtest-probe.luau.
local RESULT_ATTRIBUTE = "RobloxKitProbeResult"
local POLL_SECONDS = 0.05

if not (RunService:IsRunning() and RunService:IsServer()) then
	error("No playtest is running in this server. Start one with start_stop_play first.", 0)
end

local probe = Instance.new("Script")
probe.Name = PROBE_NAME
probe.Source = arguments.source

local waited, waitFailure = pcall(function(): string?
	probe.Parent = ServerScriptService
	local deadline = os.clock() + arguments.timeoutSeconds
	while os.clock() < deadline do
		local resultJson = probe:GetAttribute(RESULT_ATTRIBUTE)
		if typeof(resultJson) == "string" then
			return resultJson
		end
		task.wait(POLL_SECONDS)
	end
	-- One last look: the code may have finished during the final wait.
	local resultJson = probe:GetAttribute(RESULT_ATTRIBUTE)
	return if typeof(resultJson) == "string" then resultJson else nil
end)
local resultJson = if waited then waitFailure :: any else nil
probe:Destroy()
if not waited then
	error(`The probe Script could not run: {waitFailure}`, 0)
end
if typeof(resultJson) ~= "string" then
	return HttpService:JSONEncode({ status = "timed-out" })
end
return HttpService:JSONEncode({ status = "finished", result = HttpService:JSONDecode(resultJson) })
