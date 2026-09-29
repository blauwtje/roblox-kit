--!strict
-- Hides or restores the tagged ceilings of one built map, for capture_zones.
-- A ceiling's own Transparency is kept in a part attribute while it is hidden, so a restore
-- also undoes a hide that an earlier call never got to undo. Returns a short JSON count.
type Arguments = {
	mapId: string,
	mapsFolderName: string,
	ceilingTag: string,
	originalTransparencyAttribute: string,
	hidden: boolean,
}

local arguments: Arguments = ...
local CollectionService = game:GetService("CollectionService")
local HttpService = game:GetService("HttpService")
local ATTRIBUTE = arguments.originalTransparencyAttribute

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

local function hide(part: BasePart)
	-- A part that is already hidden keeps the first Transparency it was hidden from.
	if part:GetAttribute(ATTRIBUTE) == nil then
		part:SetAttribute(ATTRIBUTE, part.Transparency)
	end
	part.Transparency = 1
end

local function restore(part: BasePart)
	local original = part:GetAttribute(ATTRIBUTE)
	if type(original) ~= "number" then
		return
	end
	part.Transparency = original
	part:SetAttribute(ATTRIBUTE, nil)
end

local model = findMapModel()
local changed = 0
for _, instance in CollectionService:GetTagged(arguments.ceilingTag) do
	if instance:IsA("BasePart") and instance:IsDescendantOf(model) then
		if arguments.hidden then
			hide(instance)
			changed += 1
		elseif instance:GetAttribute(ATTRIBUTE) ~= nil then
			restore(instance)
			changed += 1
		end
	end
end
return HttpService:JSONEncode({ changed = changed })
