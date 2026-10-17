--!strict
-- The ambient effects phase of build_map: hangs each effect record's ParticleEmitter, or Beam between two
-- Attachments, under its zone's floor part. It adds no parts and an empty texture leaves the emitter untextured.
type Vector = { x: number, y: number, z: number }

type AmbientEffectRecord = {
	kind: string,
	name: string,
	zone: string,
	part: string,
	color: string,
	transparency: number,
	lightEmission: number,
	position: Vector,
	-- Beam only: the east end, and the width.
	endPosition: Vector?,
	widthStuds: number?,
	-- Particles only.
	rate: number?,
	lifetimeSeconds: number?,
	sizeStuds: number?,
	speedStuds: number?,
	texture: string?,
}

type Arguments = {
	phase: string,
	mapId: string,
	mapsFolderName: string,
	effects: { AmbientEffectRecord }?,
}

local arguments: Arguments = ...
local buildPrelude = require("./prelude")
local kit = buildPrelude(arguments)

local function addEffectAttachment(holder: BasePart, name: string, position: Vector): Attachment
	local attachment = Instance.new("Attachment")
	attachment.Name = name
	attachment.Parent = holder
	attachment.WorldPosition = kit.toVector3(position)
	return attachment
end

local function addAmbientEffect(model: Model, record: AmbientEffectRecord)
	local holder = model:FindFirstChild(record.part)
	if not holder or not holder:IsA("BasePart") then
		error(`Ambient effect "{record.name}" of zone "{record.zone}" has no floor part named "{record.part}".`, 0)
	end
	local baseName = `{record.zone}-{record.name}-ambient`
	local color = ColorSequence.new(Color3.fromHex(record.color))
	local texture = record.texture or ""
	if record.kind == "beam" then
		local endPosition = record.endPosition
		if not endPosition or not record.widthStuds then
			error(`Ambient beam "{record.name}" needs endPosition and widthStuds.`, 0)
		end
		local beam = Instance.new("Beam")
		beam.Name = baseName
		beam.Attachment0 = addEffectAttachment(holder, `{baseName}-start`, record.position)
		beam.Attachment1 = addEffectAttachment(holder, `{baseName}-end`, endPosition)
		beam.Texture = texture
		beam.Color = color
		beam.Transparency = NumberSequence.new(record.transparency)
		beam.LightEmission = record.lightEmission
		beam.Width0 = record.widthStuds
		beam.Width1 = record.widthStuds
		beam.FaceCamera = true
		beam.Parent = holder
		return
	end
	if not record.rate or not record.lifetimeSeconds or not record.sizeStuds or not record.speedStuds then
		error(`Ambient particles "{record.name}" need rate, lifetimeSeconds, sizeStuds and speedStuds.`, 0)
	end
	local emitter = Instance.new("ParticleEmitter")
	emitter.Name = baseName
	emitter.Texture = texture
	emitter.Color = color
	emitter.Transparency = NumberSequence.new(record.transparency, 1)
	emitter.LightEmission = record.lightEmission
	emitter.Rate = record.rate
	emitter.Lifetime = NumberRange.new(record.lifetimeSeconds * 0.5, record.lifetimeSeconds)
	emitter.Size = NumberSequence.new(record.sizeStuds)
	emitter.Speed = NumberRange.new(record.speedStuds * 0.5, record.speedStuds)
	emitter.SpreadAngle = Vector2.new(180, 180)
	emitter.Parent = addEffectAttachment(holder, baseName, record.position)
end

return kit.run(function()
	local model = kit.findModel()
	for _, record in arguments.effects or ({} :: { AmbientEffectRecord }) do
		addAmbientEffect(model, record)
	end
	return nil, kit.countPartChildren(model), nil
end)
