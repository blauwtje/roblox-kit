--!strict
-- Reads the props of one built map: each ProceduralModel under the map Model, named "<kind>-<n>", with the size it
-- was generated at, its pivot position, its yaw in degrees and whether its up axis is still the world's.
-- Returns a compact JSON list, so execute_luau does not cut it.
type Arguments = {
	mapId: string,
	mapsFolderName: string,
}

type Prop = {
	path: string,
	kind: string,
	size: { x: number, y: number, z: number },
	position: { x: number, y: number, z: number },
	yaw: number,
	upright: boolean,
}

-- An up axis whose Y component is under this is tilted: cos(0.5 degrees), the tolerance of the 90-degree grid.
local UPRIGHT_MINIMUM_UP_Y = 0.99996
local DECIMALS = 100

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

local function rounded(value: number): number
	return math.round(value * DECIMALS) / DECIMALS
end

local function toVector(vector: Vector3): { x: number, y: number, z: number }
	return { x = rounded(vector.X), y = rounded(vector.Y), z = rounded(vector.Z) }
end

-- The kind is the name before its trailing "-<n>".
local function kindOf(name: string): string
	return string.match(name, "^(.+)%-%d+$") or name
end

-- Turn about Y of the model's forward axis, which is 0 when it faces -Z as an unturned model does.
local function yawOf(pivot: CFrame): number
	local forward = pivot.LookVector
	return rounded(math.deg(math.atan2(-forward.X, -forward.Z)))
end

local props: { Prop } = {}
for _, child in findMapModel():GetChildren() do
	if child:IsA("ProceduralModel") then
		local pivot = child:GetPivot()
		table.insert(props, {
			path = child:GetFullName(),
			kind = kindOf(child.Name),
			size = toVector(child.Size),
			position = toVector(pivot.Position),
			yaw = yawOf(pivot),
			upright = pivot.UpVector.Y >= UPRIGHT_MINIMUM_UP_Y,
		})
	end
end

return HttpService:JSONEncode({ props = props })
