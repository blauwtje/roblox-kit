--!strict
-- Shoots a grid of rays from each given camera into the built map and returns, per shot, rows of cells
-- { distanceStuds, material, colorHex, instanceKind } (null where a ray hits nothing). Parts that capture_zones
-- hid (cutaway attribute), the ceilings of a shot that hides them and the parts under its ignored name
-- prefixes are skipped. The Studio camera is moved to each shot and restored afterwards. Changes no part.
type Shot = {
	zone: string,
	view: string,
	cameraPosition: { number },
	lookAt: { number },
	hideCeilings: boolean,
	ignoredPrefixes: { string },
}
type Arguments = {
	columns: number,
	rows: number,
	fieldOfViewDegrees: number,
	maxDistanceStuds: number,
	maxSkippedParts: number,
	ceilingTag: string,
	originalTransparencyAttribute: string,
	shots: { Shot },
}

local arguments: Arguments = ...
local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local camera = workspace.CurrentCamera :: Camera

local function hasPrefix(name: string, prefixes: { string }): boolean
	for _, prefix in prefixes do
		if string.sub(name, 1, #prefix) == prefix then
			return true
		end
	end
	return false
end

local function isSkipped(instance: Instance, shot: Shot): boolean
	if instance:GetAttribute(arguments.originalTransparencyAttribute) ~= nil then
		return true
	end
	if shot.hideCeilings and CollectionService:HasTag(instance, arguments.ceilingTag) then
		return true
	end
	return hasPrefix(instance.Name, shot.ignoredPrefixes)
end

local function colorOf(result: RaycastResult): string
	local instance = result.Instance
	if instance:IsA("Terrain") then
		return (instance :: Terrain):GetMaterialColor(result.Material):ToHex()
	end
	return (instance :: BasePart).Color:ToHex()
end

local function cast(origin: Vector3, direction: Vector3, shot: Shot): any
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	local skipped: { Instance } = {}
	for _ = 1, arguments.maxSkippedParts do
		params.FilterDescendantsInstances = skipped
		local result = workspace:Raycast(origin, direction, params)
		if result == nil then
			return nil
		end
		if not isSkipped(result.Instance, shot) then
			return {
				distanceStuds = result.Distance,
				material = result.Material.Name,
				colorHex = colorOf(result),
				instanceKind = result.Instance.ClassName,
			}
		end
		table.insert(skipped, result.Instance)
	end
	return nil
end

local function gridOf(shot: Shot, aspect: number): { { any } }
	local position = Vector3.new(table.unpack(shot.cameraPosition))
	local frame = CFrame.lookAt(position, Vector3.new(table.unpack(shot.lookAt)))
	local halfHeight = math.tan(math.rad(arguments.fieldOfViewDegrees) / 2)
	local rows = {}
	for row = 1, arguments.rows do
		local cells = {}
		local up = (1 - 2 * (row - 0.5) / arguments.rows) * halfHeight
		for column = 1, arguments.columns do
			local right = (2 * (column - 0.5) / arguments.columns - 1) * halfHeight * aspect
			local direction = (frame.LookVector + frame.RightVector * right + frame.UpVector * up).Unit
			local cell = cast(position, direction * arguments.maxDistanceStuds, shot)
			-- A false placeholder keeps the array dense; JSON turns it into null on the TypeScript side.
			cells[column] = if cell == nil then false else cell
		end
		rows[row] = cells
	end
	return rows
end

local savedFrame = camera.CFrame
local savedFieldOfView = camera.FieldOfView
local viewport = camera.ViewportSize
local aspect = if viewport.Y > 0 then viewport.X / viewport.Y else 16 / 9
local results = {}
local ok, failure = pcall(function()
	camera.FieldOfView = arguments.fieldOfViewDegrees
	for _, shot in arguments.shots do
		camera.CFrame =
			CFrame.lookAt(Vector3.new(table.unpack(shot.cameraPosition)), Vector3.new(table.unpack(shot.lookAt)))
		table.insert(results, { zone = shot.zone, view = shot.view, rows = gridOf(shot, aspect) })
	end
end)
camera.CFrame = savedFrame
camera.FieldOfView = savedFieldOfView
if not ok then
	error(tostring(failure), 0)
end
return HttpService:JSONEncode({ aspect = aspect, shots = results })
