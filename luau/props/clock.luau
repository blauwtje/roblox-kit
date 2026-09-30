--!strict
-- ProceduralModel generator source for a station clock: a large round two-faced clock on a post.
-- Params.Size is (diameter, height, depth); a dial with hour marks and hands is on both the -Z and +Z faces,
-- so the clock reads from either side, and the output stays inside Size.
-- The time shown varies per Seed so repeated clocks do not look stamped.
-- Every part is decorative: it never collides, fires touch events or answers spatial queries.
type GeneratorParams = {
	Size: Vector3,
	Attributes: { [string]: any },
	Pause: (GeneratorParams) -> (),
}

local RIM_WIDTH = 0.25
local DIAL_THICKNESS = 0.1
local MARK_THICKNESS = 0.05
local MARK_LENGTH_RATIO = 0.12
local MARK_WIDTH = 0.15
-- Gap between the hour marks and the dial's edge.
local MARK_INSET = 0.2
local HOUR_HAND_RATIO = 0.5
local MINUTE_HAND_RATIO = 0.8
local HAND_WIDTH = 0.2
local POST_WIDTH = 0.4
local BASE_HEIGHT = 0.3
local BASE_WIDTH = 1.5
local HOUR_COUNT = 12
local RIM_COLOR = Color3.fromRGB(35, 38, 42)
local DIAL_COLOR = Color3.fromRGB(245, 244, 238)
local MARK_COLOR = Color3.fromRGB(20, 20, 22)

local function addPart(
	targetContainer: Instance,
	name: string,
	size: Vector3,
	cframe: CFrame,
	color: Color3,
	material: Enum.Material,
	shape: Enum.PartType?
): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Anchored = true
	part.CanCollide = false
	part.CanTouch = false
	part.CanQuery = false
	part.Shape = shape or Enum.PartType.Block
	part.Size = size
	part.Color = color
	part.Material = material
	part.CFrame = cframe
	part.Parent = targetContainer
	return part
end

-- A cylinder's axis is its X; this turns it to Z so the round side faces -Z and +Z.
local AXIS_TO_Z = CFrame.Angles(0, math.pi / 2, 0)

-- A bar on the dial from `innerRadius` out to `outerRadius` at `angle` (clockwise from twelve as seen from
-- that face). `facing` is -1 for the -Z face and 1 for the +Z face; seen from +Z, clockwise runs toward +X.
local function addRadialBar(
	targetContainer: Instance,
	name: string,
	center: Vector3,
	facing: number,
	angle: number,
	innerRadius: number,
	outerRadius: number,
	width: number
)
	local middle = (innerRadius + outerRadius) / 2
	local x = facing * math.sin(angle) * middle
	local y = math.cos(angle) * middle
	addPart(
		targetContainer,
		name,
		Vector3.new(width, outerRadius - innerRadius, MARK_THICKNESS),
		CFrame.new(center + Vector3.new(x, y, 0)) * CFrame.Angles(0, 0, -facing * angle),
		MARK_COLOR,
		Enum.Material.SmoothPlastic
	)
end

local Generator = {}
Generator.Attributes = { Seed = 0 }

function Generator.OnGenerate(params: GeneratorParams, targetContainer: Instance)
	local size = params.Size
	local random = Random.new(params.Attributes.Seed)
	local diameter = size.X
	local center = Vector3.new(0, size.Y / 2 - diameter / 2, 0)
	local dialRadius = diameter / 2 - RIM_WIDTH
	local bottom = -size.Y / 2
	local postHeight = center.Y - bottom - BASE_HEIGHT

	addPart(
		targetContainer,
		"Base",
		Vector3.new(BASE_WIDTH, BASE_HEIGHT, math.min(BASE_WIDTH, size.Z)),
		CFrame.new(0, bottom + BASE_HEIGHT / 2, 0),
		RIM_COLOR,
		Enum.Material.Metal
	)
	addPart(
		targetContainer,
		"Post",
		Vector3.new(POST_WIDTH, postHeight, POST_WIDTH),
		CFrame.new(0, bottom + BASE_HEIGHT + postHeight / 2, 0),
		RIM_COLOR,
		Enum.Material.Metal
	)
	local rimDepth = size.Z - 2 * (DIAL_THICKNESS + MARK_THICKNESS)
	addPart(
		targetContainer,
		"Rim",
		Vector3.new(rimDepth, diameter, diameter),
		CFrame.new(center) * AXIS_TO_Z,
		RIM_COLOR,
		Enum.Material.Metal,
		Enum.PartType.Cylinder
	)

	local hours = random:NextInteger(0, HOUR_COUNT - 1)
	local minutes = random:NextInteger(0, 59)
	local hourAngle = (hours + minutes / 60) / HOUR_COUNT * 2 * math.pi
	local minuteAngle = minutes / 60 * 2 * math.pi
	for _, facing in { -1, 1 } do
		local faceName = if facing < 0 then "Front" else "Back"
		local dialZ = facing * (rimDepth / 2 + DIAL_THICKNESS / 2)
		local markCenter =
			Vector3.new(center.X, center.Y, facing * (rimDepth / 2 + DIAL_THICKNESS + MARK_THICKNESS / 2))
		addPart(
			targetContainer,
			`Dial{faceName}`,
			Vector3.new(DIAL_THICKNESS, dialRadius * 2, dialRadius * 2),
			CFrame.new(center.X, center.Y, dialZ) * AXIS_TO_Z,
			DIAL_COLOR,
			Enum.Material.SmoothPlastic,
			Enum.PartType.Cylinder
		)
		for hour = 0, HOUR_COUNT - 1 do
			local angle = hour / HOUR_COUNT * 2 * math.pi
			local inner = dialRadius * (1 - MARK_LENGTH_RATIO) - MARK_INSET
			addRadialBar(
				targetContainer,
				`Mark{faceName}{hour}`,
				markCenter,
				facing,
				angle,
				inner,
				dialRadius - MARK_INSET,
				MARK_WIDTH
			)
		end
		addRadialBar(
			targetContainer,
			`HourHand{faceName}`,
			markCenter,
			facing,
			hourAngle,
			0,
			dialRadius * HOUR_HAND_RATIO,
			HAND_WIDTH
		)
		addRadialBar(
			targetContainer,
			`MinuteHand{faceName}`,
			markCenter,
			facing,
			minuteAngle,
			0,
			dialRadius * MINUTE_HAND_RATIO,
			HAND_WIDTH
		)
	end
	params:Pause()
end

return Generator
