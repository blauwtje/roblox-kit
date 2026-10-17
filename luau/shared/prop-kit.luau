--!strict
-- Shared by the prop generators of luau/props/: the slot look and the decorative Part every generator builds with.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

type Look = { Color: Color3, Material: Enum.Material }

return {
	-- The default of each `<Slot>Color` attribute, Roblox's default Part color.
	DEFAULT_COLOR = Color3.fromRGB(163, 162, 165),

	-- The color and material of a prop slot, named as in `Frame`: its `<Slot>Material` attribute holds an Enum.Material name.
	slotLook = function(attributes: { [string]: any }, slot: string): Look
		local material = Enum.Material:FromName(attributes[`{slot}Material`]) :: Enum.Material
		return { Color = attributes[`{slot}Color`], Material = material }
	end,

	-- A decorative Part: it never collides, fires touch events or answers spatial queries. `cframe` defaults to `position`.
	addPart = function(
		targetContainer: Instance,
		name: string,
		size: Vector3,
		position: Vector3,
		look: Look,
		shape: Enum.PartType?,
		cframe: CFrame?
	): Part
		local part = Instance.new("Part")
		part.Name = name
		part.Anchored = true
		part.CanCollide = false
		part.CanTouch = false
		part.CanQuery = false
		if shape then
			part.Shape = shape
		end
		part.Size = size
		part.Color = look.Color
		part.Material = look.Material
		part.CFrame = cframe or CFrame.new(position)
		part.Parent = targetContainer
		return part
	end,
}
