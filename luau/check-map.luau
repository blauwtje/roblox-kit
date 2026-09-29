--!strict
-- Checks one built map for overlapping parts, floating parts and zones the spawn cannot reach.
-- Returns counts plus capped issue lists, kept short because execute_luau cuts long results.
type Arguments = {
	mapId: string,
	mapsFolderName: string,
	overlapToleranceStuds: number,
	maxIssuesPerKind: number,
	floorNameSuffix: string,
	agentRadiusStuds: number,
	agentHeightStuds: number,
}

type Position = { x: number, y: number, z: number }

type Issue = {
	kind: string,
	parts: { string },
	position: Position,
	detail: string,
}

type Box = {
	part: BasePart,
	min: Vector3,
	max: Vector3,
}

-- Side of a Terrain voxel, which ReadVoxels takes as its resolution.
local TERRAIN_VOXEL_STUDS = 4

local arguments: Arguments = ...
local MAX_ISSUES_PER_KIND = arguments.maxIssuesPerKind
local FLOOR_NAME_SUFFIX = arguments.floorNameSuffix
local PathfindingService = game:GetService("PathfindingService")
local HttpService = game:GetService("HttpService")

local function toPosition(point: Vector3): Position
	return { x = point.X, y = point.Y, z = point.Z }
end

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

-- The axis-aligned box around a part in world space, which is exact for the unrotated parts build_map makes.
local function boxOf(part: BasePart): Box
	local halfSize = part.Size / 2
	local rotation = part.CFrame.Rotation
	local right, up, back = rotation.RightVector, rotation.UpVector, -rotation.LookVector
	local halfExtent = Vector3.new(
		math.abs(right.X) * halfSize.X + math.abs(up.X) * halfSize.Y + math.abs(back.X) * halfSize.Z,
		math.abs(right.Y) * halfSize.X + math.abs(up.Y) * halfSize.Y + math.abs(back.Y) * halfSize.Z,
		math.abs(right.Z) * halfSize.X + math.abs(up.Z) * halfSize.Y + math.abs(back.Z) * halfSize.Z
	)
	return { part = part, min = part.Position - halfExtent, max = part.Position + halfExtent }
end

local function collectBoxes(model: Model): { Box }
	local boxes: { Box } = {}
	for _, descendant in model:GetDescendants() do
		if descendant:IsA("BasePart") then
			table.insert(boxes, boxOf(descendant))
		end
	end
	table.sort(boxes, function(first: Box, second: Box)
		return first.min.X < second.min.X
	end)
	return boxes
end

-- Whether solid Terrain lies within the voxel cell around the middle of a part's bottom face.
local function restsOnTerrain(box: Box): boolean
	local center = Vector3.new(box.part.Position.X, box.min.Y, box.part.Position.Z)
	local reach = Vector3.new(1, 1, 1) * arguments.overlapToleranceStuds
	local region = Region3.new(center - reach, center + reach):ExpandToGrid(TERRAIN_VOXEL_STUDS)
	local materials, occupancies = workspace.Terrain:ReadVoxels(region, TERRAIN_VOXEL_STUDS)
	local size = materials.Size
	for xIndex = 1, size.X do
		for yIndex = 1, size.Y do
			for zIndex = 1, size.Z do
				if
					materials[xIndex][yIndex][zIndex] ~= Enum.Material.Air
					and occupancies[xIndex][yIndex][zIndex] > 0
				then
					return true
				end
			end
		end
	end
	return false
end

-- A part rests on the ground when its top is at or below the ground plane (y = 0) or Terrain lies against it.
local function isGround(box: Box): boolean
	return box.max.Y <= arguments.overlapToleranceStuds or restsOnTerrain(box)
end

local function newIssueLists(): { [string]: { Issue } }
	return { overlapping = {}, floating = {}, unreachable = {} }
end

local issues = newIssueLists()
local issueCounts: { [string]: number } = { overlapping = 0, floating = 0, unreachable = 0 }

local function addIssue(issue: Issue)
	issueCounts[issue.kind] += 1
	local kindIssues = issues[issue.kind]
	if #kindIssues < MAX_ISSUES_PER_KIND then
		table.insert(kindIssues, issue)
	end
end

-- How far two boxes interpenetrate along each axis; negative on an axis where they are apart.
local function overlapExtent(first: Box, second: Box): Vector3
	return Vector3.new(
		math.min(first.max.X, second.max.X) - math.max(first.min.X, second.min.X),
		math.min(first.max.Y, second.max.Y) - math.max(first.min.Y, second.min.Y),
		math.min(first.max.Z, second.max.Z) - math.max(first.min.Z, second.min.Z)
	)
end

-- Two passes per collidable part: GetPartBoundsInBox on the box shrunk by the tolerance cheaply drops parts that
-- only touch, then GetPartsInPart confirms the survivors against the exact shape. OverlapParams.RespectCanCollide
-- leaves decorative parts out of both results. The reported depth comes from the axis-aligned boxes, which is
-- exact for the unrotated parts build_map makes.
local function findOverlaps(model: Model, boxes: { Box })
	local tolerance = arguments.overlapToleranceStuds
	local params = OverlapParams.new()
	params.FilterType = Enum.RaycastFilterType.Include
	params.FilterDescendantsInstances = { model }
	params.RespectCanCollide = true
	local boxOfPart: { [BasePart]: Box } = {}
	for _, box in boxes do
		boxOfPart[box.part] = box
	end
	local reported: { [BasePart]: boolean } = {}
	for _, first in boxes do
		local part = first.part
		if not part.CanCollide then
			continue
		end
		local broadSize = part.Size - Vector3.new(2, 2, 2) * tolerance
		if broadSize.X <= 0 or broadSize.Y <= 0 or broadSize.Z <= 0 then
			continue
		end
		local broad: { [BasePart]: boolean } = {}
		for _, candidate in workspace:GetPartBoundsInBox(part.CFrame, broadSize, params) do
			broad[candidate] = true
		end
		-- Each pair is reported from the part processed first, so a part already handled is skipped.
		reported[part] = true
		for _, other in workspace:GetPartsInPart(part, params) do
			if other == part or reported[other] or not broad[other] then
				continue
			end
			local second = boxOfPart[other]
			local extent = overlapExtent(first, second)
			local center = Vector3.new(
				math.max(first.min.X, second.min.X) + extent.X / 2,
				math.max(first.min.Y, second.min.Y) + extent.Y / 2,
				math.max(first.min.Z, second.min.Z) + extent.Z / 2
			)
			addIssue({
				kind = "overlapping",
				parts = { part:GetFullName(), other:GetFullName() },
				position = toPosition(center),
				detail = `interpenetrate by {string.format("%.2f", math.min(extent.X, extent.Y, extent.Z))} studs`,
			})
		end
	end
end

-- The five points a floating part is cast from: the middle of its bottom face and its four footprint corners,
-- each pulled in by the tolerance so a corner ray does not slip past the edge of the part below.
local function rayOrigins(box: Box): { Vector3 }
	local inset = arguments.overlapToleranceStuds
	local originY = box.min.Y + inset
	local minX, maxX = box.min.X + inset, box.max.X - inset
	local minZ, maxZ = box.min.Z + inset, box.max.Z - inset
	return {
		Vector3.new(box.part.Position.X, originY, box.part.Position.Z),
		Vector3.new(minX, originY, minZ),
		Vector3.new(minX, originY, maxZ),
		Vector3.new(maxX, originY, minZ),
		Vector3.new(maxX, originY, maxZ),
	}
end

-- A collidable part is supported when any of its five downward rays hits another collidable part or Terrain within
-- the tolerance below its bottom face, or the part is ground. Decorative parts (CanCollide false, CanQuery false)
-- hang on walls instead of resting on the ground, so they are neither checked nor hit. A part resting only on a part
-- that itself floats counts as supported; lift this by grounding hits recursively.
local function findFloating(boxes: { Box })
	local tolerance = arguments.overlapToleranceStuds
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.RespectCanCollide = true
	params.IgnoreWater = true
	local reach = Vector3.new(0, -2 * tolerance, 0)
	for _, box in boxes do
		local part = box.part
		if not part.CanCollide or isGround(box) then
			continue
		end
		params.FilterDescendantsInstances = { part }
		local supported = false
		for _, origin in rayOrigins(box) do
			if workspace:Raycast(origin, reach, params) then
				supported = true
				break
			end
		end
		if not supported then
			addIssue({
				kind = "floating",
				parts = { part:GetFullName() },
				position = toPosition(part.Position),
				detail = `no part or terrain within {tolerance} studs below its center or footprint corners`,
			})
		end
	end
end

-- Whether a point lies over or under the footprint of a box, seen from above.
local function isWithinFootprint(box: Box, point: Vector3): boolean
	return point.X >= box.min.X and point.X <= box.max.X and point.Z >= box.min.Z and point.Z <= box.max.Z
end

-- The point on top of a floor part, at its center.
local function standingPointOn(floor: BasePart): Vector3
	local box = boxOf(floor)
	return Vector3.new(floor.Position.X, box.max.Y, floor.Position.Z)
end

local function findUnreachableZones(boxes: { Box }): (number, boolean)
	local spawns: { BasePart } = {}
	local floors: { BasePart } = {}
	for _, box in boxes do
		if box.part:IsA("SpawnLocation") then
			table.insert(spawns, box.part)
		elseif string.sub(box.part.Name, -#FLOOR_NAME_SUFFIX) == FLOOR_NAME_SUFFIX then
			table.insert(floors, box.part)
		end
	end
	table.sort(spawns, function(first: BasePart, second: BasePart)
		return first.Name < second.Name
	end)
	local spawnPart = spawns[1]
	if spawnPart == nil then
		return #floors, false
	end
	local path = PathfindingService:CreatePath({
		AgentRadius = arguments.agentRadiusStuds,
		AgentHeight = arguments.agentHeightStuds,
	})
	local start = standingPointOn(spawnPart)
	for _, floor in floors do
		-- The zone holding the spawn is where the walk starts, and its center may lie under the spawn pad itself.
		if isWithinFootprint(boxOf(floor), spawnPart.Position) then
			continue
		end
		local target = standingPointOn(floor)
		local computed, failure = pcall(function()
			path:ComputeAsync(start, target)
		end)
		if not computed or path.Status ~= Enum.PathStatus.Success then
			local reason = if computed then tostring(path.Status) else tostring(failure)
			local zoneName = string.sub(floor.Name, 1, -#FLOOR_NAME_SUFFIX - 1)
			addIssue({
				kind = "unreachable",
				parts = { floor:GetFullName() },
				position = toPosition(target),
				detail = `no walkable path from {spawnPart:GetFullName()} to zone "{zoneName}" ({reason})`,
			})
		end
	end
	return #floors, true
end

local model = findMapModel()
local boxes = collectBoxes(model)
findOverlaps(model, boxes)
findFloating(boxes)
local zoneCount, reachabilityChecked = findUnreachableZones(boxes)

return HttpService:JSONEncode({
	partCount = #boxes,
	zoneCount = zoneCount,
	reachabilityChecked = reachabilityChecked,
	counts = issueCounts,
	issues = issues,
})
