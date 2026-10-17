--!strict
-- The lighting phase of build_map: each light record becomes a PointLight under an Attachment under its fixture box,
-- a Neon part tagged like the ceilings only for a pendant, or without one under the floor part of its zone; a light
-- without a box within `ceilingDropStuds` of the ceiling above it also gets a Neon fixture part against that ceiling,
-- tagged like the ceilings. Reports the number of parts in the Model after the phase (the BaseParts that are children
-- of the Model).
type Vector = { x: number, y: number, z: number }

type LightRecord = {
	zone: string,
	part: string,
	role: string,
	position: Vector,
	range: number,
	shadows: boolean,
	-- The visible box that holds the light; a pendant hangs from the ceiling and hides with it.
	-- With `glow` the fixture's Part is a Neon ball of that diameter, `drop` studs below the box's centre.
	fixture: { position: Vector, size: Vector, pendant: boolean, glow: { diameter: number, drop: number }? }?,
	brightness: number,
	color: string,
}

type Arguments = {
	phase: string,
	mapId: string,
	mapsFolderName: string,
	lights: { LightRecord }?,
	ceilingTag: string?,
	-- How far below a ceiling a light may hang to get a fixture, and the fixture's side.
	ceilingDropStuds: number?,
	fixtureSizeStuds: number?,
}

local FIXTURE_TOLERANCE_STUDS = 0.001

local arguments: Arguments = ...
local CollectionService = game:GetService("CollectionService")
local buildPrelude = require("./prelude")
local kit = buildPrelude(arguments)

-- A Neon box in the light's color; only a pendant is tagged, so cutaways hide it with the ceilings.
local function addFixtureBox(model: Model, record: LightRecord, fixtureNumber: number): Part
	local box = record.fixture
	local ceilingTag = arguments.ceilingTag
	if not box or not ceilingTag then
		error("A fixture box needs its record's fixture and ceilingTag.", 0)
	end
	local fixture = Instance.new("Part")
	fixture.Name = `{record.zone}-{record.role}-fixture-{fixtureNumber}`
	fixture.Anchored = true
	fixture.CanCollide = false
	fixture.CanTouch = false
	fixture.CanQuery = false
	fixture.CastShadow = false
	fixture.Material = Enum.Material.Neon
	fixture.Color = Color3.fromHex(record.color)
	if box.glow then
		fixture.Shape = Enum.PartType.Ball
		fixture.Size = Vector3.one * box.glow.diameter
		fixture.Position = kit.toVector3(box.position) - Vector3.new(0, box.glow.drop, 0)
	else
		fixture.Size = kit.toVector3(box.size)
		fixture.Position = kit.toVector3(box.position)
	end
	if box.pendant then
		CollectionService:AddTag(fixture, ceilingTag)
	end
	fixture.Parent = model
	return fixture
end

-- A light hangs from an Attachment on its fixture box when it has one, else on its zone's floor part, which adds no part.
local function addLight(model: Model, record: LightRecord, fixtureNumber: number)
	local holder = model:FindFirstChild(record.part)
	if record.fixture then
		holder = addFixtureBox(model, record, fixtureNumber)
	end
	if not holder or not holder:IsA("BasePart") then
		error(`Light "{record.role}" of zone "{record.zone}" has no floor part named "{record.part}".`, 0)
	end
	local attachment = Instance.new("Attachment")
	attachment.Name = `{record.zone}-{record.role}-light`
	attachment.Parent = holder
	attachment.WorldPosition = kit.toVector3(record.position)
	local light = Instance.new("PointLight")
	light.Range = record.range
	light.Brightness = record.brightness
	light.Color = Color3.fromHex(record.color)
	light.Shadows = record.shadows
	light.Parent = attachment
end

-- The bottom face height of the tagged ceiling over the point, if any.
local function ceilingBottomOver(model: Model, position: Vector, ceilingTag: string): number?
	for _, tagged in CollectionService:GetTagged(ceilingTag) do
		if tagged:IsDescendantOf(model) and tagged:IsA("BasePart") then
			local offset = tagged.CFrame:PointToObjectSpace(kit.toVector3(position))
			if math.abs(offset.X) <= tagged.Size.X / 2 and math.abs(offset.Z) <= tagged.Size.Z / 2 then
				return tagged.Position.Y - tagged.Size.Y / 2
			end
		end
	end
	return nil
end

-- A Neon cube against the ceiling over a light within the drop of it; it hides with the ceilings by their tag.
local function addFixture(model: Model, record: LightRecord)
	local ceilingTag, dropStuds, sizeStuds =
		arguments.ceilingTag, arguments.ceilingDropStuds, arguments.fixtureSizeStuds
	if not ceilingTag or not dropStuds or not sizeStuds then
		error("A lighting phase needs ceilingTag, ceilingDropStuds and fixtureSizeStuds.", 0)
	end
	local ceilingBottom = ceilingBottomOver(model, record.position, ceilingTag)
	-- Studio positions carry float error, so the drop is compared with a tolerance.
	if not ceilingBottom or ceilingBottom - record.position.y > dropStuds + FIXTURE_TOLERANCE_STUDS then
		return
	end
	local fixture = Instance.new("Part")
	fixture.Name = `{record.zone}-{record.role}-fixture`
	fixture.Anchored = true
	fixture.CanCollide = false
	fixture.CanTouch = false
	fixture.CanQuery = false
	fixture.CastShadow = false
	fixture.Material = Enum.Material.Neon
	fixture.Color = Color3.fromHex(record.color)
	fixture.Size = Vector3.new(sizeStuds, sizeStuds, sizeStuds)
	fixture.Position = Vector3.new(record.position.x, ceilingBottom - sizeStuds / 2, record.position.z)
	CollectionService:AddTag(fixture, ceilingTag)
	fixture.Parent = model
end

local function addLights(model: Model)
	local fixtureCount = 0
	for _, record in arguments.lights or ({} :: { LightRecord }) do
		if record.fixture then
			fixtureCount += 1
		end
		addLight(model, record, fixtureCount)
		if not record.fixture then
			addFixture(model, record)
		end
	end
end

return kit.run(function()
	local model = kit.findModel()
	addLights(model)
	return nil, kit.countPartChildren(model), nil
end)
