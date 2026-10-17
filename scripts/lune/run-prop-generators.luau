--!nocheck
-- Runs inlined prop generators outside Studio, under Lune, with small shims of the Roblox API they use.
-- Usage: lune run scripts/lune/run-prop-generators.luau '<json>', where the JSON is
-- { "directory": "<folder of <kind>.luau files>", "runs": [{ "kind": "lamp", "size": [x, y, z], "seed": 3 }] }.
-- Every color attribute a generator declares is given its own sentinel color and Material attribute a sentinel
-- material, so a part look that no slot supplied shows. Prints one JSON array holding, per run, the sentinel
-- looks, the parts (color in 0-255, material name, axis-aligned box about the pivot, decorative flags) and the texts.
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local serde = require("@lune/serde")

local SENTINEL_COLORS = {
	{ 230, 40, 60 },
	{ 40, 200, 70 },
	{ 50, 80, 235 },
	{ 240, 190, 30 },
	{ 190, 50, 220 },
	{ 30, 210, 220 },
	{ 250, 120, 20 },
	{ 120, 30, 150 },
	{ 20, 130, 90 },
	{ 200, 90, 130 },
}
local SENTINEL_MATERIALS = {
	"Wood",
	"Metal",
	"Glass",
	"Fabric",
	"Brick",
	"Concrete",
	"Marble",
	"Slate",
	"Granite",
	"CeramicTiles",
}

-- Vector3 and CFrame ---------------------------------------------------------------------------------------------

local Vector3 = {}
Vector3.__index = Vector3
function Vector3.new(x, y, z)
	return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, Vector3)
end
Vector3.zero = Vector3.new(0, 0, 0)
function Vector3.__add(a, b)
	return Vector3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z)
end
function Vector3.__sub(a, b)
	return Vector3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z)
end
function Vector3.__mul(a, b)
	if type(a) == "number" then
		a, b = b, a
	end
	if type(b) == "number" then
		return Vector3.new(a.X * b, a.Y * b, a.Z * b)
	end
	return Vector3.new(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
end
function Vector3.__div(a, b)
	if type(b) == "number" then
		return Vector3.new(a.X / b, a.Y / b, a.Z / b)
	end
	return Vector3.new(a.X / b.X, a.Y / b.Y, a.Z / b.Z)
end
function Vector3.__unm(a)
	return Vector3.new(-a.X, -a.Y, -a.Z)
end

-- A CFrame holds a position and the rotation matrix `r` (row-major, 9 numbers).
local CFrame = {}
CFrame.__index = CFrame
local IDENTITY = { 1, 0, 0, 0, 1, 0, 0, 0, 1 }

local function makeCFrame(position, r)
	return setmetatable({ Position = position, r = r or IDENTITY }, CFrame)
end

local function multiplyMatrices(a, b)
	local result = {}
	for row = 0, 2 do
		for column = 0, 2 do
			local sum = 0
			for k = 0, 2 do
				sum += a[row * 3 + k + 1] * b[k * 3 + column + 1]
			end
			result[row * 3 + column + 1] = sum
		end
	end
	return result
end

function CFrame.new(x, y, z)
	if type(x) == "table" then
		return makeCFrame(x)
	end
	return makeCFrame(Vector3.new(x or 0, y or 0, z or 0))
end
-- Roblox applies the rotations about X, then Y, then Z in the object's frame: R = Rx * Ry * Rz.
function CFrame.Angles(rx, ry, rz)
	local cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
	local rotationX = { 1, 0, 0, 0, cx, -sx, 0, sx, cx }
	local rotationY = { cy, 0, sy, 0, 1, 0, -sy, 0, cy }
	local rotationZ = { cz, -sz, 0, sz, cz, 0, 0, 0, 1 }
	return makeCFrame(Vector3.zero, multiplyMatrices(multiplyMatrices(rotationX, rotationY), rotationZ))
end
function CFrame.__mul(a, b)
	local r = a.r
	if getmetatable(b) == Vector3 then
		return Vector3.new(
			r[1] * b.X + r[2] * b.Y + r[3] * b.Z + a.Position.X,
			r[4] * b.X + r[5] * b.Y + r[6] * b.Z + a.Position.Y,
			r[7] * b.X + r[8] * b.Y + r[9] * b.Z + a.Position.Z
		)
	end
	return makeCFrame(a * b.Position, multiplyMatrices(a.r, b.r))
end

-- Color3, Enum, Random and UI value types -------------------------------------------------------------------------

local Color3 = {}
Color3.__index = Color3
function Color3.new(r, g, b)
	return setmetatable({ R = r or 0, G = g or 0, B = b or 0 }, Color3)
end
function Color3.fromRGB(r, g, b)
	return Color3.new(r / 255, g / 255, b / 255)
end
function Color3:Lerp(other, alpha)
	return Color3.new(
		self.R + (other.R - self.R) * alpha,
		self.G + (other.G - self.G) * alpha,
		self.B + (other.B - self.B) * alpha
	)
end

local Enum = setmetatable({}, {
	__index = function(enums, enumName)
		local items = setmetatable({}, {
			__index = function(_, itemName)
				return { Name = itemName, EnumType = enumName }
			end,
		})
		rawset(enums, enumName, items)
		return items
	end,
})
Enum.Material = setmetatable({
	FromName = function(_, name)
		return { Name = name, EnumType = "Material" }
	end,
}, {
	__index = function(_, itemName)
		return { Name = itemName, EnumType = "Material" }
	end,
})

-- mulberry32 stands in for Roblox's Random: seeded, deterministic, uniform.
local Random = {}
Random.__index = Random
function Random.new(seed)
	return setmetatable({ state = (seed or 0) * 2654435761 % 4294967296 }, Random)
end
function Random:_next()
	self.state = (self.state + 0x6D2B79F5) % 4294967296
	local t = self.state
	t = bit32.bxor(t, bit32.rshift(t, 15)) * (bit32.bor(t, 1)) % 4294967296
	t = bit32.bxor(t, t + bit32.bxor(t, bit32.rshift(t, 7)) * bit32.bor(t, 61) % 4294967296)
	return bit32.bxor(t, bit32.rshift(t, 14)) / 4294967296
end
function Random:NextNumber(minimum, maximum)
	return (minimum or 0) + self:_next() * ((maximum or 1) - (minimum or 0))
end
function Random:NextInteger(minimum, maximum)
	return minimum + math.floor(self:_next() * (maximum - minimum + 1))
end

local UDim2 = {
	fromScale = function(x, y)
		return { XScale = x, YScale = y }
	end,
}
local Vector2 = {
	new = function(x, y)
		return { X = x, Y = y }
	end,
}

-- Instance ------------------------------------------------------------------------------------------------------

local created = {}

local function newInstance(className)
	local instance = { ClassName = className, Name = className }
	if className == "Part" then
		instance.CanCollide = true
		instance.CanTouch = true
		instance.CanQuery = true
		instance.Anchored = false
		instance.Size = Vector3.new(4, 1, 2)
		instance.CFrame = CFrame.new(0, 0, 0)
		instance.Color = Color3.fromRGB(163, 162, 165)
		instance.Material = { Name = "Plastic", EnumType = "Material" }
	end
	table.insert(created, instance)
	return instance
end

-- Running -------------------------------------------------------------------------------------------------------

local function roundTo(value, places)
	local scale = 10 ^ places
	return math.floor(value * scale + 0.5) / scale
end

local function boxOf(part)
	local r = part.CFrame.r
	local half = { part.Size.X / 2, part.Size.Y / 2, part.Size.Z / 2 }
	local center = part.CFrame.Position
	local minimum, maximum = {}, {}
	for axis, value in { center.X, center.Y, center.Z } do
		local reach = 0
		for column = 1, 3 do
			reach += math.abs(r[(axis - 1) * 3 + column]) * half[column]
		end
		minimum[axis] = roundTo(value - reach, 4)
		maximum[axis] = roundTo(value + reach, 4)
	end
	return minimum, maximum
end

local function partRecord(part)
	local minimum, maximum = boxOf(part)
	return {
		name = part.Name,
		canCollide = part.CanCollide,
		canTouch = part.CanTouch,
		canQuery = part.CanQuery,
		color = { roundTo(part.Color.R * 255, 3), roundTo(part.Color.G * 255, 3), roundTo(part.Color.B * 255, 3) },
		material = part.Material.Name,
		min = minimum,
		max = maximum,
	}
end

local environment = {
	Vector3 = Vector3,
	CFrame = CFrame,
	Color3 = Color3,
	Enum = Enum,
	Random = Random,
	UDim2 = UDim2,
	Vector2 = Vector2,
	Instance = { new = newInstance },
	math = math,
	string = string,
	table = table,
	bit32 = bit32,
	pairs = pairs,
	ipairs = ipairs,
	type = type,
	typeof = type,
	tostring = tostring,
	tonumber = tonumber,
	select = select,
	unpack = unpack,
}

local function loadGenerator(directory, kind)
	local path = `{directory}/{kind}.luau`
	return luau.load(fs.readFile(path), { debugName = path, environment = environment })()
end

local function sortedColorAttributes(generator)
	local names = {}
	for name in generator.Attributes do
		if string.match(name, "Color$") then
			table.insert(names, name)
		end
	end
	table.sort(names)
	return names
end

local function runGenerator(generator, run)
	created = {}
	local attributes = table.clone(generator.Attributes)
	attributes.Seed = run.seed
	local looks = {}
	for index, name in sortedColorAttributes(generator) do
		local color = SENTINEL_COLORS[index]
		attributes[name] = Color3.fromRGB(color[1], color[2], color[3])
		looks[name] = { color = color, material = SENTINEL_MATERIALS[index] }
		local materialName = string.gsub(name, "Color$", "Material")
		if generator.Attributes[materialName] ~= nil then
			attributes[materialName] = SENTINEL_MATERIALS[index]
		end
	end
	local container = {}
	local params = {
		Size = Vector3.new(run.size[1], run.size[2], run.size[3]),
		Attributes = attributes,
		Pause = function() end,
	}
	generator.OnGenerate(params, container)
	local parts, texts = {}, {}
	for _, instance in created do
		if instance.ClassName == "Part" then
			table.insert(parts, partRecord(instance))
		elseif instance.ClassName == "TextLabel" then
			table.insert(texts, instance.Text)
		end
	end
	return { kind = run.kind, size = run.size, seed = run.seed, looks = looks, parts = parts, texts = texts }
end

local request = serde.decode("json", process.args[1])
local generators = {}
local results = {}
for _, run in request.runs do
	generators[run.kind] = generators[run.kind] or loadGenerator(request.directory, run.kind)
	table.insert(results, runGenerator(generators[run.kind], run))
end
print(serde.encode("json", results))
