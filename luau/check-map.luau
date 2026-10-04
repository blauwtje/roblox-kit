--!strict
-- Checks one built map for overlapping parts, floating parts, props out of place (not on a floor, inside a wall or
-- in a doorway clearance box) and zones or objectives a spawn cannot reach.
-- Returns counts plus capped issue lists, kept short because execute_luau cuts long results, and a warning per
-- instance outside the map that stands in the way of a failed walk.
type Arguments = {
	mapId: string,
	mapsFolderName: string,
	overlapToleranceStuds: number,
	maxIssuesPerKind: number,
	floorNameSuffix: string,
	wallNameInfix: string,
	agentRadiusStuds: number,
	agentHeightStuds: number,
	maxPathStuds: number,
	objectives: { { name: string, x: number, y: number, z: number } },
	-- The clear space in front of each doorway, in world studs.
	doorways: { { room: string, side: string, min: Position, max: Position } },
}

type Position = { x: number, y: number, z: number }

type Issue = {
	kind: string,
	parts: { string },
	position: Position,
	detail: string,
}

type Bounds = {
	min: Vector3,
	max: Vector3,
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

-- The axis-aligned bounds around a box of the given size at a pose in world space.
local function boundsOf(pose: CFrame, size: Vector3): Bounds
	local halfSize = size / 2
	local rotation = pose.Rotation
	local right, up, back = rotation.RightVector, rotation.UpVector, -rotation.LookVector
	local halfExtent = Vector3.new(
		math.abs(right.X) * halfSize.X + math.abs(up.X) * halfSize.Y + math.abs(back.X) * halfSize.Z,
		math.abs(right.Y) * halfSize.X + math.abs(up.Y) * halfSize.Y + math.abs(back.Y) * halfSize.Z,
		math.abs(right.Z) * halfSize.X + math.abs(up.Z) * halfSize.Y + math.abs(back.Z) * halfSize.Z
	)
	return { min = pose.Position - halfExtent, max = pose.Position + halfExtent }
end

-- The axis-aligned box around a part in world space, which is exact for the unrotated parts build_map makes.
local function boxOf(part: BasePart): Box
	local bounds = boundsOf(part.CFrame, part.Size)
	return { part = part, min = bounds.min, max = bounds.max }
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
	return { overlapping = {}, floating = {}, unreachable = {}, placement = {} }
end

local issues = newIssueLists()
local issueCounts: { [string]: number } = { overlapping = 0, floating = 0, unreachable = 0, placement = 0 }

local function addIssue(issue: Issue)
	issueCounts[issue.kind] += 1
	local kindIssues = issues[issue.kind]
	if #kindIssues < MAX_ISSUES_PER_KIND then
		table.insert(kindIssues, issue)
	end
end

-- How far two boxes interpenetrate along each axis; negative on an axis where they are apart.
local function overlapExtent(first: Bounds, second: Bounds): Vector3
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
local function rayOrigins(bounds: Bounds): { Vector3 }
	local inset = arguments.overlapToleranceStuds
	local originY = bounds.min.Y + inset
	local minX, maxX = bounds.min.X + inset, bounds.max.X - inset
	local minZ, maxZ = bounds.min.Z + inset, bounds.max.Z - inset
	local center = (bounds.min + bounds.max) / 2
	return {
		Vector3.new(center.X, originY, center.Z),
		Vector3.new(minX, originY, minZ),
		Vector3.new(minX, originY, maxZ),
		Vector3.new(maxX, originY, minZ),
		Vector3.new(maxX, originY, maxZ),
	}
end

-- A collidable part is supported when one of its five downward rays hits Terrain, a part outside the map, or a map
-- part that is itself grounded, within the tolerance below its bottom face; ground parts are grounded. Grounding
-- spreads upward from the ground through the parts the rays hit, so a stack resting on a floating part floats too.
-- Decorative parts (CanCollide false, CanQuery false) hang on walls instead of resting on the ground, so they are
-- neither checked nor hit.
local function findFloating(model: Model, boxes: { Box })
	local tolerance = arguments.overlapToleranceStuds
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.RespectCanCollide = true
	params.IgnoreWater = true
	local reach = Vector3.new(0, -2 * tolerance, 0)
	local grounded: { [BasePart]: boolean } = {}
	local pending: { BasePart } = {}
	-- For each map part a ray hit, the parts resting on it.
	local restingOn: { [BasePart]: { BasePart } } = {}
	local checked: { Box } = {}
	for _, box in boxes do
		local part = box.part
		if not part.CanCollide then
			continue
		end
		if isGround(box) then
			grounded[part] = true
			table.insert(pending, part)
			continue
		end
		table.insert(checked, box)
		params.FilterDescendantsInstances = { part }
		for _, origin in rayOrigins(box) do
			local hit = workspace:Raycast(origin, reach, params)
			if hit == nil then
				continue
			end
			local support = hit.Instance
			if support:IsA("BasePart") and support:IsDescendantOf(model) then
				restingOn[support] = restingOn[support] or {}
				table.insert(restingOn[support], part)
			elseif not grounded[part] then
				grounded[part] = true
				table.insert(pending, part)
			end
		end
	end
	while #pending > 0 do
		local support = table.remove(pending) :: BasePart
		for _, resting in restingOn[support] or {} do
			if not grounded[resting] then
				grounded[resting] = true
				table.insert(pending, resting)
			end
		end
	end
	for _, box in checked do
		local part = box.part
		if not grounded[part] then
			addIssue({
				kind = "floating",
				parts = { part:GetFullName() },
				position = toPosition(part.Position),
				detail = `no part or terrain within {tolerance} studs below its center or footprint corners leads down to the ground`,
			})
		end
	end
end

-- Whether two bounds interpenetrate by more than the tolerance on every axis, so bounds that only touch do not count.
local function interpenetrate(first: Bounds, second: Bounds): boolean
	local extent = overlapExtent(first, second)
	local tolerance = arguments.overlapToleranceStuds
	return extent.X > tolerance and extent.Y > tolerance and extent.Z > tolerance
end

-- Whether any of a prop's five downward rays lands on a floor part within the tolerance below its bottom face.
local function restsOnFloor(bounds: Bounds, floorParams: RaycastParams): boolean
	local reach = Vector3.new(0, -2 * arguments.overlapToleranceStuds, 0)
	for _, origin in rayOrigins(bounds) do
		if workspace:Raycast(origin, reach, floorParams) then
			return true
		end
	end
	return false
end

-- Whether two bounds touch or interpenetrate within the tolerance on every axis.
local function touchOrOverlap(first: Bounds, second: Bounds): boolean
	local extent = overlapExtent(first, second)
	local tolerance = arguments.overlapToleranceStuds
	return extent.X >= -tolerance and extent.Y >= -tolerance and extent.Z >= -tolerance
end

-- Whether a prop's bounds touch a wall part, which carries a wall-mounted prop such as a sign.
local function restsOnWall(bounds: Bounds, walls: { Box }): boolean
	for _, wall in walls do
		if touchOrOverlap(bounds, wall) then
			return true
		end
	end
	return false
end

-- Attribute that build-map.luau sets on a hero Model, naming its kind.
local HERO_KIND_ATTRIBUTE_NAME = "RobloxKitHeroKind"

-- The pose and size a placed prop is checked at: a ProceduralModel's declared Size about its pivot, or a hero
-- Model's bounding box; nil for any other child.
local function placedBox(child: Instance): (CFrame?, Vector3?)
	if child:IsA("ProceduralModel") then
		return child:GetPivot(), child.Size
	end
	if child:IsA("Model") and child:GetAttribute(HERO_KIND_ATTRIBUTE_NAME) ~= nil then
		return child:GetBoundingBox()
	end
	return nil, nil
end

-- Each ProceduralModel prop, at its declared Size about its pivot, and each hero Model, at its bounding box,
-- must rest on a floor part or touch a wall part,
-- stay out of every wall part and stay out of every doorway clearance box. A prop standing on another prop or on a set piece has no floor
-- under its rays and is reported; the rule can be lifted by adding those parts to the rays' include list.
local function findPlacement(model: Model, boxes: { Box }, floors: { BasePart })
	local walls: { Box } = {}
	for _, box in boxes do
		if string.find(box.part.Name, arguments.wallNameInfix, 1, true) then
			table.insert(walls, box)
		end
	end
	local floorParams = RaycastParams.new()
	floorParams.FilterType = Enum.RaycastFilterType.Include
	floorParams.FilterDescendantsInstances = floors
	for _, child in model:GetChildren() do
		local pivot, size = placedBox(child)
		if not pivot or not size then
			continue
		end
		local bounds = boundsOf(pivot, size)
		local path = child:GetFullName()
		local position = toPosition(pivot.Position)
		if not restsOnFloor(bounds, floorParams) and not restsOnWall(bounds, walls) then
			addIssue({
				kind = "placement",
				parts = { path },
				position = position,
				detail = `no floor under its center or footprint corners within {arguments.overlapToleranceStuds * 2} studs below it, and it touches no wall`,
			})
		end
		for _, wall in walls do
			if interpenetrate(bounds, wall) then
				addIssue({
					kind = "placement",
					parts = { path, wall.part:GetFullName() },
					position = position,
					detail = `overlaps the wall part {wall.part.Name}`,
				})
			end
		end
		for _, doorway in arguments.doorways do
			local clearance = {
				min = Vector3.new(doorway.min.x, doorway.min.y, doorway.min.z),
				max = Vector3.new(doorway.max.x, doorway.max.y, doorway.max.z),
			}
			if interpenetrate(bounds, clearance) then
				addIssue({
					kind = "placement",
					parts = { path },
					position = position,
					detail = `inside the doorway clearance box of the {doorway.side} wall of room "{doorway.room}"`,
				})
			end
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

-- A place a walk from a spawn must reach: a room floor or an objective point of the spec.
type Target = {
	description: string,
	point: Vector3,
	-- The floor part of a room target, which is skipped for a spawn standing on it; nil for an objective.
	floor: BasePart?,
}

local function collectSpawnsAndFloors(boxes: { Box }): ({ BasePart }, { BasePart })
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
	return spawns, floors
end

local function collectTargets(floors: { BasePart }): { Target }
	local targets: { Target } = {}
	for _, floor in floors do
		local zoneName = string.sub(floor.Name, 1, -#FLOOR_NAME_SUFFIX - 1)
		table.insert(targets, {
			description = `zone "{zoneName}"`,
			point = standingPointOn(floor),
			floor = floor,
		})
	end
	for _, objective in arguments.objectives do
		table.insert(targets, {
			description = `objective "{objective.name}"`,
			point = Vector3.new(objective.x, objective.y, objective.z),
			floor = nil,
		})
	end
	return targets
end

-- Why a walk from start to target fails, or nil when pcall(ComputeAsync) succeeds with a non-empty waypoint list.
local function pathFailure(path: Path, start: Vector3, target: Vector3): string?
	local computed, failure = pcall(function()
		path:ComputeAsync(start, target)
	end)
	if not computed then
		return tostring(failure)
	end
	if path.Status ~= Enum.PathStatus.Success then
		return tostring(path.Status)
	end
	if #path:GetWaypoints() == 0 then
		return "no waypoints"
	end
	return nil
end

-- Most instances outside the map that one failed walk names as blockers.
local MAX_BLOCKERS_PER_WALK = 5

-- The instance outside the map that owns a hit part: its ancestor directly under Workspace or under the maps folder,
-- so another map is named by its Model.
local function ownerOf(part: Instance, mapsFolder: Instance?): Instance
	local owner = part
	while owner.Parent and owner.Parent ~= workspace and owner.Parent ~= mapsFolder do
		owner = owner.Parent
	end
	return owner
end

-- The instances outside the map whose collidable parts cross the straight line from start to target at half the
-- agent's height, nearest first. Terrain is left out: it is part of the place, not another model.
local function blockersBetween(model: Model, start: Vector3, target: Vector3): { Instance }
	local lift = Vector3.new(0, arguments.agentHeightStuds / 2, 0)
	local origin, direction = start + lift, (target + lift) - (start + lift)
	local mapsFolder = model.Parent
	local excluded: { Instance } = { model, workspace.Terrain }
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.RespectCanCollide = true
	params.IgnoreWater = true
	local blockers: { Instance } = {}
	while #blockers < MAX_BLOCKERS_PER_WALK do
		params.FilterDescendantsInstances = excluded
		local hit = workspace:Raycast(origin, direction, params)
		if hit == nil then
			break
		end
		local owner = ownerOf(hit.Instance, mapsFolder)
		table.insert(blockers, owner)
		table.insert(excluded, owner)
	end
	return blockers
end

-- Per instance outside the map, how many failed walks it blocks and the first of them.
type Blocking = { walks: number, firstWalk: string }
local blocking: { [Instance]: Blocking } = {}
local blockingOrder: { Instance } = {}

local function noteBlockers(model: Model, start: Vector3, target: Vector3, walk: string)
	for _, blocker in blockersBetween(model, start, target) do
		local entry = blocking[blocker]
		if entry == nil then
			blocking[blocker] = { walks = 1, firstWalk = walk }
			table.insert(blockingOrder, blocker)
		else
			entry.walks += 1
		end
	end
end

local function blockerWarnings(): { string }
	local warnings: { string } = {}
	for _, blocker in blockingOrder do
		local entry = blocking[blocker]
		table.insert(
			warnings,
			`{blocker:GetFullName()} is not part of this map and blocks {entry.walks} failed walk(s), first {entry.firstWalk}; move it or build the map elsewhere`
		)
	end
	return warnings
end

-- Checks one { spawn, target } pair per spawn and target. A pair further apart than the straight-line limit is
-- reported as tooFar without asking the pathfinder, which does not plan over such distances.
local function findUnreachableTargets(model: Model, spawns: { BasePart }, targets: { Target })
	local path = PathfindingService:CreatePath({
		AgentRadius = arguments.agentRadiusStuds,
		AgentHeight = arguments.agentHeightStuds,
	})
	for _, spawnPart in spawns do
		local start = standingPointOn(spawnPart)
		for _, target in targets do
			-- The zone holding the spawn is where the walk starts, and its center may lie under the spawn pad itself.
			if target.floor and isWithinFootprint(boxOf(target.floor), spawnPart.Position) then
				continue
			end
			local distance = (target.point - start).Magnitude
			local failure: string?
			if distance > arguments.maxPathStuds then
				failure =
					`tooFar: {string.format("%.0f", distance)} studs apart, over the {arguments.maxPathStuds} stud limit`
			else
				failure = pathFailure(path, start, target.point)
				if failure then
					noteBlockers(model, start, target.point, `from {spawnPart:GetFullName()} to {target.description}`)
				end
			end
			if failure then
				local parts = { spawnPart:GetFullName() }
				if target.floor then
					table.insert(parts, target.floor:GetFullName())
				end
				addIssue({
					kind = "unreachable",
					parts = parts,
					position = toPosition(target.point),
					detail = `no walkable path from {spawnPart:GetFullName()} to {target.description} ({failure})`,
				})
			end
		end
	end
end

local model = findMapModel()
local boxes = collectBoxes(model)
findOverlaps(model, boxes)
findFloating(model, boxes)
local spawns, floors = collectSpawnsAndFloors(boxes)
findPlacement(model, boxes, floors)
findUnreachableTargets(model, spawns, collectTargets(floors))

return HttpService:JSONEncode({
	partCount = #boxes,
	zoneCount = #floors,
	reachabilityChecked = #spawns > 0,
	counts = issueCounts,
	issues = issues,
	warnings = blockerWarnings(),
})
