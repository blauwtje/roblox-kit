--!strict
-- The floors and ceilings, openings and surfaces phases of build_map: each adds its part records to the Model the
-- shell phase built. Floors, spawns and ceilings are tagged `ceilingTag` for the ceilings; the detail parts are
-- decorative. Reports the number of parts in the Model after the phase (the BaseParts that are children of the Model).
type Vector = { x: number, y: number, z: number }

type PartRecord = {
	name: string,
	kind: string,
	position: Vector,
	size: Vector,
	role: string,
	color: string,
	material: string,
	-- Present and false on a decorative detail part.
	canCollide: boolean?,
}

type Variant = {
	baseMaterial: string,
	studsPerTile: number,
	maps: { color: string, normal: string, roughness: string, metalness: string }?,
	materialPattern: string?,
}

type Arguments = {
	phase: string,
	mapId: string,
	mapsFolderName: string,
	parts: { PartRecord }?,
	ceilingTag: string?,
	-- Flat MaterialVariant of each surface role that has one.
	variants: { [string]: Variant }?,
}

local arguments: Arguments = ...
local buildPrelude = require("./prelude")
local kit = buildPrelude(arguments)
local buildPartKit = require("./part-kit")
local partKit = buildPartKit(arguments, kit)

return kit.run(function()
	local model = kit.findModel()
	partKit.addParts(model, arguments.parts)
	return nil, kit.countPartChildren(model), nil
end)
