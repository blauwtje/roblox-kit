--!strict
-- Pooled client script for every built map's NPCs. One Heartbeat loop serves all NPC models under
-- `<map>/Npcs`: it poses the ones within sight radius of the camera from their attributes (idle, sit,
-- chat, walk) and shows a chat bubble now and then. Walkers follow their route back and forth
-- (same schedule as src/npc/npc-schedule.ts); the route graph JSON sits on the folder as `RouteGraph`.
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local TextChatService = game:GetService("TextChatService")

local MAPS_FOLDER = "RobloxKitMaps"
local FOLDER_NAME = "Npcs"
local DWELL_SECONDS = 3

type Point = { x: number, z: number }

local function walkerPosition(route: { Point }, speed: number, phase: number, seconds: number): (Vector3, number)
	local total = 0
	local lengths = {}
	for i = 2, #route do
		local length = math.sqrt((route[i].x - route[i - 1].x) ^ 2 + (route[i].z - route[i - 1].z) ^ 2)
		lengths[i - 1] = length
		total += length
	end
	local first = route[1]
	if total == 0 or speed <= 0 then
		return Vector3.new(first.x, 0, first.z), 0
	end
	local half = total / speed + DWELL_SECONDS
	local cycle = 2 * half
	local localTime = (seconds + phase * cycle) % cycle
	local forward = localTime < half
	local leg = if forward then localTime else localTime - half
	local distance = math.min(leg * speed, total)
	local rest = if forward then distance else total - distance
	for i, length in lengths do
		if rest <= length or i == #lengths then
			local a, b = route[i], route[i + 1]
			local t = if length == 0 then 0 else math.min(rest / length, 1)
			local dx, dz = (b.x - a.x) * (if forward then 1 else -1), (b.z - a.z) * (if forward then 1 else -1)
			return Vector3.new(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t), math.atan2(-dx, -dz)
		end
		rest -= length
	end
	return Vector3.new(first.x, 0, first.z), 0
end

local function findFolders(): { Folder }
	local found = {}
	local maps = workspace:FindFirstChild(MAPS_FOLDER)
	if maps then
		for _, map in maps:GetChildren() do
			local folder = map:FindFirstChild(FOLDER_NAME)
			if folder and folder:IsA("Folder") then
				table.insert(found, folder)
			end
		end
	end
	return found
end

local nextBubble: { [Model]: number } = {}
local routes: { [Model]: { Point } } = {}
local baseHeights: { [Model]: number } = {}

local function routeOf(npc: Model): { Point }?
	local cached = routes[npc]
	if cached then
		return cached
	end
	local json = npc:GetAttribute("Route")
	if typeof(json) ~= "string" then
		return nil
	end
	routes[npc] = HttpService:JSONDecode(json)
	baseHeights[npc] = npc:GetPivot().Position.Y
	return routes[npc]
end

local function bubble(npc: Model, now: number, interval: number)
	if (nextBubble[npc] or 0) > now then
		return
	end
	nextBubble[npc] = now + interval * (0.5 + math.random())
	local lines = HttpService:JSONDecode(npc:GetAttribute("ChatLines") :: string)
	local head = npc:FindFirstChild("Head")
	if head and #lines > 0 then
		TextChatService:DisplayBubble(head, lines[math.random(#lines)])
	end
end

local function pose(npc: Model, now: number, interval: number)
	local behavior = npc:GetAttribute("Behavior")
	if behavior == "chat" then
		bubble(npc, now, interval)
	elseif behavior == "walk" then
		local route = routeOf(npc)
		if route then
			local position, yaw =
				walkerPosition(route, npc:GetAttribute("Speed") :: number, npc:GetAttribute("Phase") :: number, now)
			npc:PivotTo(CFrame.new(position.X, baseHeights[npc], position.Z) * CFrame.Angles(0, yaw, 0))
		end
	end
end

RunService.Heartbeat:Connect(function()
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end
	local now = workspace:GetServerTimeNow()
	for _, folder in findFolders() do
		local radius = folder:GetAttribute("SightRadius") :: number
		local interval = folder:GetAttribute("BubbleInterval") :: number
		for _, npc in folder:GetChildren() do
			-- Walkers always move, so one out of sight is not stranded where the camera left it.
			if npc:IsA("Model") then
				local near = (npc:GetPivot().Position - camera.CFrame.Position).Magnitude <= radius
				if near or npc:GetAttribute("Behavior") == "walk" then
					pose(npc, now, interval)
				end
			end
		end
	end
end)
