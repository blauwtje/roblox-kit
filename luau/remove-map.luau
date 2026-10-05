--!strict
-- Removes one built map: fills its terrain with Air, destroys its MaterialVariants and its Model, and destroys
-- the maps folder when nothing else is left in it. Reads its inputs as data from `arguments`; nothing is interpolated.
type Arguments = {
	mapId: string,
	mapsFolderName: string,
	-- The surface roles; build-map.luau names a map's MaterialVariants `<mapId>-<role>`.
	roles: { string },
}

type TerrainFill = {
	material: string,
	center: { number },
	size: { number }?,
	radius: number?,
}

-- Attribute on the map Model holding the terrain fills of its build as JSON; build-map.luau writes it.
local TERRAIN_ATTRIBUTE_NAME = "RobloxKitTerrainFills"
-- Attribute on the maps folder holding the place's original Lighting; apply-lighting.luau owns it.
local ORIGINAL_ATTRIBUTE_NAME = "RobloxKitOriginalLighting"

local arguments: Arguments = ...
local HttpService = game:GetService("HttpService")
local MaterialService = game:GetService("MaterialService")

local folder = workspace:FindFirstChild(arguments.mapsFolderName)
local model = if folder then folder:FindFirstChild(arguments.mapId) else nil
if not folder or not model or not model:IsA("Model") then
	error(`Map "{arguments.mapId}" is not under Workspace.{arguments.mapsFolderName}; nothing was removed.`, 0)
end

local function toVector3(coordinates: { number }): Vector3
	return Vector3.new(coordinates[1], coordinates[2], coordinates[3])
end

local encodedFills = model:GetAttribute(TERRAIN_ATTRIBUTE_NAME)
if typeof(encodedFills) == "string" then
	for _, fill in HttpService:JSONDecode(encodedFills) :: { TerrainFill } do
		if fill.size then
			workspace.Terrain:FillBlock(CFrame.new(toVector3(fill.center)), toVector3(fill.size), Enum.Material.Air)
		elseif fill.radius then
			workspace.Terrain:FillBall(toVector3(fill.center), fill.radius, Enum.Material.Air)
		end
	end
end

-- Exact names only, so another map's variants (`<other>-<role>`) are never touched.
for _, role in arguments.roles do
	local variant = MaterialService:FindFirstChild(`{arguments.mapId}-{role}`)
	if variant and variant:IsA("MaterialVariant") then
		variant:Destroy()
	end
end

model:Destroy()

if #folder:GetChildren() == 0 and folder:GetAttribute(ORIGINAL_ATTRIBUTE_NAME) == nil then
	folder:Destroy()
end

return HttpService:JSONEncode({ removed = true })
