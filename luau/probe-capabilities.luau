--!strict
-- Probe file for smoke:studio: tries what the server needs from execute_luau and reports each try.
local HttpService = game:GetService("HttpService")
local ServerStorage = game:GetService("ServerStorage")

type Capability = { capability: string, ok: boolean, detail: string }

local capabilities: { Capability } = {}

-- Runs one try; a returned string is the detail of a success, an error message that of a failure.
local function probe(capability: string, attempt: () -> string)
	local succeeded, outcome = pcall(attempt)
	table.insert(capabilities, { capability = capability, ok = succeeded, detail = tostring(outcome) })
end

-- Runs `use` on a temporary Instance and destroys it afterwards, even when `use` fails.
local function withTemporary<T>(instance: Instance, use: (Instance) -> T): T
	local succeeded, outcome = pcall(use, instance)
	instance:Destroy()
	if not succeeded then
		error(outcome, 0)
	end
	return outcome
end

probe("StudioTestService methods", function()
	-- Indexing a member whose security level is above the caller's raises the capability error.
	local StudioTestService = game:GetService("StudioTestService")
	local names = { "ExecutePlayModeAsync", "ExecuteRunModeAsync", "ExecuteMultiplayerTestAsync" }
	for _, name in names do
		local _ = (StudioTestService :: any)[name]
	end
	return `reached {table.concat(names, ", ")}`
end)

probe("Script.Source", function()
	local temporaryScript = Instance.new("Script")
	temporaryScript.Parent = ServerStorage
	return withTemporary(temporaryScript, function(instance)
		local scriptInstance = instance :: Script
		scriptInstance.Source = "return 1"
		return `wrote and read back: {scriptInstance.Source}`
	end)
end)

probe("ChangeHistoryService waypoint", function()
	game:GetService("ChangeHistoryService"):SetWaypoint("roblox-kit probe")
	return "SetWaypoint accepted"
end)

probe("Edit-mode spatial queries", function()
	local floor = Instance.new("Part")
	floor.Anchored = true
	floor.Size = Vector3.new(40, 1, 40)
	floor.Position = Vector3.new(0, 5000, 0)
	floor.Parent = workspace
	return withTemporary(floor, function()
		local hit = workspace:Raycast(Vector3.new(0, 5010, 0), Vector3.new(0, -20, 0))
		local inBox = workspace:GetPartBoundsInBox(CFrame.new(0, 5000, 0), Vector3.new(4, 4, 4))
		if hit == nil or #inBox == 0 then
			error("Raycast or GetPartBoundsInBox missed the new part", 0)
		end
		return `Raycast hit at y={hit.Position.Y}; GetPartBoundsInBox found {#inBox} part(s)`
	end)
end)

probe("PathfindingService in Edit", function()
	local floor = Instance.new("Part")
	floor.Anchored = true
	floor.Size = Vector3.new(60, 1, 60)
	floor.Position = Vector3.new(0, 5000, 0)
	floor.Parent = workspace
	return withTemporary(floor, function()
		local path = game:GetService("PathfindingService"):CreatePath()
		path:ComputeAsync(Vector3.new(-20, 5002, 0), Vector3.new(20, 5002, 0))
		if path.Status ~= Enum.PathStatus.Success then
			error(`path status {path.Status.Name}`, 0)
		end
		return `path status Success with {#path:GetWaypoints()} waypoint(s)`
	end)
end)

return HttpService:JSONEncode(capabilities)
