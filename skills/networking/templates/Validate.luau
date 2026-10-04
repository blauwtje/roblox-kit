--!strict
-- Checks Blink cannot make. Blink already rejects out-of-range numbers, NaN (since 0.18.9), wrong Instance
-- classes and malformed buffers before game code runs; these helpers cover what is left, so call them at the top
-- of each `From: Client` listener, before any server state changes.
--
-- All helpers take `unknown`, so they are safe on anything a client can send, and return false rather than throw.

local Validate = {}

-- Roblox's Luau has no math.isfinite: NaN is the only value not equal to itself, and the infinities are math.huge.
local function isFinite(number: number): boolean
	return number == number and number ~= math.huge and number ~= -math.huge
end

-- A number that is not NaN and not infinite. Use for unranged `f32`/`f64` fields and any number Blink cannot
-- bound, such as a Vector3 component.
function Validate.isFiniteNumber(value: unknown): boolean
	if typeof(value) ~= "number" then
		return false
	end
	return isFinite(value)
end

-- A Vector3 whose three components are all finite. Blink's `vector` has no range, so a client can send NaN or
-- infinity; also check the position against the game's own bounds before using it.
function Validate.isFiniteVector3(value: unknown): boolean
	if typeof(value) ~= "Vector3" then
		return false
	end
	return isFinite(value.X) and isFinite(value.Y) and isFinite(value.Z)
end

-- An Instance that lives under `container`, for any class. Blink's `Instance(Model)` checks the class only, so a
-- client can still name any Model in the place; this ties it to, for example, the folder of pickup items.
function Validate.isInstanceWithin(value: unknown, container: Instance): boolean
	if typeof(value) ~= "Instance" then
		return false
	end
	return value:IsDescendantOf(container)
end

return Validate
