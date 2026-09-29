--!strict
-- Reads the zones (rooms) of one built map with the studs bounds of each, for capture_zones.
-- Returns a short JSON list, so execute_luau does not cut it.
type Arguments = {
	mapId: string,
	mapsFolderName: string,
}

type Position = { x: number, y: number, z: number }

type Zone = {
	name: string,
	min: Position,
	max: Position,
}

-- Suffixes and prefix that build_map gives the parts of a room: the floor names the zone.
local FLOOR_NAME_SUFFIX = "-floor"
local SPAWN_NAME_SUFFIX = "-spawn"
local WALL_NAME_INFIX = "-wall-"

local arguments: Arguments = ...
local HttpService = game:GetService("HttpService")

local function findMapModel(): Model
	local folder = workspace:FindFirstChild(arguments.mapsFolderName)
	local model = if folder then folder:FindFirstChild(arguments.mapId) else nil
	if model == nil or not model:IsA("Model") then
		error(
			`No map "{arguments.mapId}" under Workspace.{arguments.mapsFolderName}. Call build_map with this mapId first, or use the mapId it returned.`,
			0
		)
	end
	return model
end

-- Half the extent of a part's world bounding box, exact for the unrotated parts build_map makes.
local function halfExtentOf(part: BasePart): Vector3
	local halfSize = part.Size / 2
	local rotation = part.CFrame.Rotation
	local right, up, back = rotation.RightVector, rotation.UpVector, -rotation.LookVector
	return Vector3.new(
		math.abs(right.X) * halfSize.X + math.abs(up.X) * halfSize.Y + math.abs(back.X) * halfSize.Z,
		math.abs(right.Y) * halfSize.X + math.abs(up.Y) * halfSize.Y + math.abs(back.Y) * halfSize.Z,
		math.abs(right.Z) * halfSize.X + math.abs(up.Z) * halfSize.Y + math.abs(back.Z) * halfSize.Z
	)
end

local function zoneNameOfPart(partName: string, zoneNames: { string }): string?
	for _, zoneName in zoneNames do
		if
			partName == zoneName .. FLOOR_NAME_SUFFIX
			or partName == zoneName .. SPAWN_NAME_SUFFIX
			or string.sub(partName, 1, #zoneName + #WALL_NAME_INFIX) == zoneName .. WALL_NAME_INFIX
		then
			return zoneName
		end
	end
	return nil
end

local function widen(zone: Zone, part: BasePart)
	local center, halfExtent = part.Position, halfExtentOf(part)
	zone.min = {
		x = math.min(zone.min.x, center.X - halfExtent.X),
		y = math.min(zone.min.y, center.Y - halfExtent.Y),
		z = math.min(zone.min.z, center.Z - halfExtent.Z),
	}
	zone.max = {
		x = math.max(zone.max.x, center.X + halfExtent.X),
		y = math.max(zone.max.y, center.Y + halfExtent.Y),
		z = math.max(zone.max.z, center.Z + halfExtent.Z),
	}
end

local model = findMapModel()
local parts: { BasePart } = {}
local zoneNames: { string } = {}
for _, descendant in model:GetDescendants() do
	if descendant:IsA("BasePart") then
		table.insert(parts, descendant)
		if string.sub(descendant.Name, -#FLOOR_NAME_SUFFIX) == FLOOR_NAME_SUFFIX then
			table.insert(zoneNames, string.sub(descendant.Name, 1, -#FLOOR_NAME_SUFFIX - 1))
		end
	end
end
table.sort(zoneNames)

local zonesByName: { [string]: Zone } = {}
for _, part in parts do
	local zoneName = zoneNameOfPart(part.Name, zoneNames)
	if zoneName == nil then
		continue
	end
	local zone = zonesByName[zoneName]
	if zone == nil then
		local center, halfExtent = part.Position, halfExtentOf(part)
		zone = {
			name = zoneName,
			min = { x = center.X - halfExtent.X, y = center.Y - halfExtent.Y, z = center.Z - halfExtent.Z },
			max = { x = center.X + halfExtent.X, y = center.Y + halfExtent.Y, z = center.Z + halfExtent.Z },
		}
		zonesByName[zoneName] = zone
	else
		widen(zone, part)
	end
end

local zones: { Zone } = {}
for _, zoneName in zoneNames do
	table.insert(zones, zonesByName[zoneName])
end
return HttpService:JSONEncode({ zones = zones })
