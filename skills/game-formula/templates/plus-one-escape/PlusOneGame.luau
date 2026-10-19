--!strict
-- "+1 Strength every second" escape game. Put this ModuleScript in ServerScriptService next to PlusOneMain.server.
-- It builds the whole world under Workspace.GameFormulaPlusOne, runs the loop and exposes the functions the
-- playtest checks drive: tick, tryGate, finish, rebirth. Needs the ModuleScript GameFormulaJuice in ReplicatedStorage.
local Debris = game:GetService("Debris")
local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

-- Every tunable lives here.
local CONFIG = {
	folderName = "GameFormulaPlusOne",
	rebirthRemoteName = "PlusOneRebirth",
	strengthLabelName = "StrengthLabel",
	seed = 7,

	-- The loop.
	tickSeconds = 1,
	strengthPerTick = 1,
	padMultiplier = 3,
	padHeadroom = 8,
	orbStrength = 5,
	orbRespawnSeconds = 10,

	-- Gate thresholds grow as base * growth ^ (stage - 1), rounded to this many significant digits.
	stageCount = 9,
	gateBase = 15,
	gateGrowth = 1.9,
	gateSignificantDigits = 2,
	gateReformSeconds = 45,
	gateTouchCooldown = 1.2,
	gateBounceSpeed = 70,
	gateBounceLift = 35,

	-- Rebirth: needs rebirthWinsBase + rebirthWinsStep * rebirths Wins, then multiplier = 1 + rebirths * step.
	rebirthWinsBase = 1,
	rebirthWinsStep = 1,
	rebirthMultiplierStep = 1,

	-- Win sequence.
	winCutsceneSeconds = 3,
	fadeSeconds = 0.6,

	-- Layout in studs. The track runs north (-Z) from the lobby.
	lobbySize = 60,
	trackWidth = 28,
	stageLength = 70,
	finishLength = 60,
	gateThickness = 4,
	gateHeight = 20,
	gateColumns = 6,
	gateRows = 4,
	wallHeight = 26,
	gapLength = 12,
	killBrickSize = 5,
	killBrickSeconds = 2.2,
	killBrickRespawnSeconds = 1,
	padSize = 14,
	voidDepth = 60,
	scenerySpacing = 35,
	shotGateStage = 5,

	bandColors = { Color3.fromRGB(70, 220, 90), Color3.fromRGB(150, 70, 235), Color3.fromRGB(255, 200, 30) },
	killColor = Color3.fromRGB(255, 50, 60),
	padColor = Color3.fromRGB(255, 120, 200),
}

type Juice = {
	popText: (position: Vector3, text: string, color: Color3?) -> (),
	burst: (position: Vector3, color: Color3?, count: number?) -> (),
	spin: (part: BasePart, secondsPerTurn: number?) -> (),
	bob: (part: BasePart, height: number?) -> (),
	fade: (player: Player, seconds: number?) -> (),
	cutscene: (player: Player, cframes: { CFrame }, seconds: number) -> (),
	pulse: (player: Player, label: string) -> (),
}

export type GateResult = {
	ok: boolean,
	reason: string, -- "opened", "passed", "too weak" or "locked"
	needed: number,
	strength: number,
	stage: number,
}

export type ActionResult = { ok: boolean, reason: string }

type PlayerState = {
	checkpoint: number,
	winning: boolean,
	lastGateTouch: number,
	lastRespawn: number,
}

type Gate = {
	folder: Folder,
	broken: boolean,
	generation: number,
	color: Color3,
}

local juice: Juice
local worldFolder: Folder
local padParts: { Part } = {}
local gates: { [number]: Gate } = {}
local states: { [Player]: PlayerState } = {}
local autoTick = true
local started = false
local archPosition = Vector3.zero

local Game = {}
Game.config = CONFIG

-- Geometry ---------------------------------------------------------------------------------------------------

local function segmentStartZ(stage: number): number
	return -CONFIG.lobbySize / 2 - (stage - 1) * CONFIG.stageLength
end

local function gateZ(stage: number): number
	return segmentStartZ(stage + 1) + CONFIG.gateThickness / 2
end

local function lobbySpawnCFrame(): CFrame
	return CFrame.new(0, 0, CONFIG.lobbySize / 4)
end

local function checkpointCFrame(stage: number): CFrame
	if stage <= 0 then
		return lobbySpawnCFrame()
	end
	return CFrame.new(0, 0, gateZ(stage) - CONFIG.gateThickness - 4)
end

local function stageColor(stage: number): Color3
	local bands = CONFIG.bandColors
	local t = if CONFIG.stageCount > 1 then (stage - 1) / (CONFIG.stageCount - 1) else 0
	local scaled = t * (#bands - 1)
	local index = math.min(math.floor(scaled) + 1, #bands - 1)
	return bands[index]:Lerp(bands[index + 1], scaled - (index - 1))
end

local function roundSignificant(value: number, digits: number): number
	if value < 10 ^ digits then
		return math.round(value)
	end
	local magnitude = 10 ^ (math.floor(math.log10(value)) - digits + 1)
	return math.round(value / magnitude) * magnitude
end

local function gateThreshold(stage: number): number
	return roundSignificant(CONFIG.gateBase * CONFIG.gateGrowth ^ (stage - 1), CONFIG.gateSignificantDigits)
end

local function formatNumber(value: number): string
	if value >= 1e6 then
		return string.format("%.1fM", value / 1e6)
	elseif value >= 1e3 then
		return string.format("%.1fK", value / 1e3)
	end
	return tostring(math.floor(value))
end

-- Instance helpers -------------------------------------------------------------------------------------------

local function newPart(
	parent: Instance,
	name: string,
	size: Vector3,
	cframe: CFrame,
	color: Color3,
	material: Enum.Material?
): Part
	local part = Instance.new("Part")
	part.Name = name
	part.Size = size
	part.CFrame = cframe
	part.Color = color
	part.Material = material or Enum.Material.SmoothPlastic
	part.Anchored = true
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Parent = parent
	return part
end

local function newBillboard(part: BasePart, text: string, widthStuds: number, heightStuds: number, color: Color3)
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromScale(widthStuds, heightStuds)
	gui.AlwaysOnTop = true
	gui.MaxDistance = 400
	gui.LightInfluence = 0
	gui.Parent = part
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Text = text
	label.TextScaled = true
	label.Font = Enum.Font.GothamBlack
	label.TextColor3 = color
	label.Parent = gui
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 4
	stroke.Color = Color3.fromRGB(20, 20, 30)
	stroke.Parent = label
end

local function playerFromHit(hit: BasePart): Player?
	local model = hit:FindFirstAncestorOfClass("Model")
	if model == nil then
		return nil
	end
	return Players:GetPlayerFromCharacter(model)
end

local function rootPart(player: Player): BasePart?
	local character = player.Character
	if character == nil then
		return nil
	end
	local root = character:FindFirstChild("HumanoidRootPart")
	if root ~= nil and root:IsA("BasePart") then
		return root
	end
	return nil
end

local function headPosition(player: Player): Vector3?
	local character = player.Character
	local head = if character ~= nil then character:FindFirstChild("Head") else nil
	if head ~= nil and head:IsA("BasePart") then
		return head.Position + Vector3.new(0, 2, 0)
	end
	return nil
end

local function teleportTo(player: Player, cframe: CFrame)
	local character = player.Character
	local root = rootPart(player)
	if character ~= nil and root ~= nil then
		character:PivotTo(cframe + Vector3.new(0, 4, 0))
		root.AssemblyLinearVelocity = Vector3.zero
	end
end

-- Stats ------------------------------------------------------------------------------------------------------

local function statValue(player: Player, name: string): IntValue
	local leaderstats = player:WaitForChild("leaderstats", 10)
	local value = if leaderstats ~= nil then leaderstats:WaitForChild(name, 10) else nil
	if value == nil or not value:IsA("IntValue") then
		error(`leaderstats.{name} is missing for {player.Name}`)
	end
	return value
end

local function multiplierFor(rebirths: number): number
	return 1 + rebirths * CONFIG.rebirthMultiplierStep
end

local function rebirthWinsRequired(rebirths: number): number
	return CONFIG.rebirthWinsBase + CONFIG.rebirthWinsStep * rebirths
end

local function refreshAttributes(player: Player)
	local state = states[player]
	if state == nil then
		return
	end
	local rebirths = statValue(player, "Rebirths").Value
	local nextStage = state.checkpoint + 1
	player:SetAttribute("NextGate", if nextStage <= CONFIG.stageCount then gateThreshold(nextStage) else 0)
	player:SetAttribute("PreviousGate", if state.checkpoint >= 1 then gateThreshold(state.checkpoint) else 0)
	player:SetAttribute("Multiplier", multiplierFor(rebirths))
	player:SetAttribute("RebirthWins", rebirthWinsRequired(rebirths))
	player:SetAttribute("Checkpoint", state.checkpoint)
end

function Game.multiplier(player: Player): number
	return multiplierFor(statValue(player, "Rebirths").Value)
end

function Game.padFactor(player: Player): number
	local root = rootPart(player)
	if root == nil then
		return 1
	end
	for _, pad in padParts do
		local offset = pad.CFrame:PointToObjectSpace(root.Position)
		if
			math.abs(offset.X) <= pad.Size.X / 2
			and math.abs(offset.Z) <= pad.Size.Z / 2
			and offset.Y > 0
			and offset.Y < CONFIG.padHeadroom
		then
			return CONFIG.padMultiplier
		end
	end
	return 1
end

function Game.getState(player: Player): PlayerState?
	return states[player]
end

function Game.setAutoTick(enabled: boolean)
	autoTick = enabled
end

function Game.getPads(): { Part }
	return padParts
end

function Game.isGateBroken(stage: number): boolean
	local gate = gates[stage]
	return gate ~= nil and gate.broken
end

function Game.isWinning(player: Player): boolean
	local state = states[player]
	return state ~= nil and state.winning
end

function Game.getLobbyCFrame(): CFrame
	return lobbySpawnCFrame()
end

function Game.gateThreshold(stage: number): number
	return gateThreshold(stage)
end

function Game.rebirthWinsRequired(rebirths: number): number
	return rebirthWinsRequired(rebirths)
end

function Game.setStrength(player: Player, amount: number)
	statValue(player, "Strength").Value = amount
end

-- Adds Strength with the rebirth multiplier but no pad bonus, for pickups and for checks.
function Game.addStrength(player: Player, amount: number): number
	local gained = math.max(1, math.floor(amount * Game.multiplier(player)))
	local strength = statValue(player, "Strength")
	strength.Value += gained
	return gained
end

-- Gains one tick per tickSeconds in `seconds`; each tick is strengthPerTick * rebirth multiplier * pad bonus.
-- Returns the Strength gained.
function Game.tick(player: Player, seconds: number): number
	local state = states[player]
	if state == nil or state.winning then
		return 0
	end
	local ticks = math.floor(seconds / CONFIG.tickSeconds + 1e-6)
	if ticks <= 0 then
		return 0
	end
	local perTick = math.max(1, math.floor(CONFIG.strengthPerTick * Game.multiplier(player) * Game.padFactor(player)))
	local total = perTick * ticks
	statValue(player, "Strength").Value += total
	local position = headPosition(player)
	if position ~= nil then
		juice.popText(position, `+{perTick}`, Color3.fromRGB(255, 240, 90))
	end
	juice.pulse(player, CONFIG.strengthLabelName)
	return total
end

-- Gates -----------------------------------------------------------------------------------------------------

local function sendToCheckpoint(player: Player)
	local state = states[player]
	if state ~= nil then
		state.lastRespawn = os.clock()
		teleportTo(player, checkpointCFrame(state.checkpoint))
	end
end

local function shatter(stage: number)
	local gate = gates[stage]
	if gate == nil or gate.broken then
		return
	end
	gate.broken = true
	gate.generation += 1
	local generation = gate.generation
	local random = Random.new(CONFIG.seed + stage)
	local center = Vector3.new(0, CONFIG.gateHeight / 2, gateZ(stage))
	for _, child in gate.folder:GetChildren() do
		if child:IsA("BasePart") then
			child.Anchored = false
			child.CanCollide = false
			child.CanTouch = false
			local outward = (child.Position - center).Unit
			child.AssemblyLinearVelocity = outward * random:NextNumber(30, 70)
				+ Vector3.new(0, random:NextNumber(20, 50), random:NextNumber(-20, 10))
			child.AssemblyAngularVelocity =
				Vector3.new(random:NextNumber(-8, 8), random:NextNumber(-8, 8), random:NextNumber(-8, 8))
			Debris:AddItem(child, 4)
		end
	end
	juice.burst(center, gate.color, 60)
	task.delay(CONFIG.gateReformSeconds, function()
		if gates[stage] == gate and gate.generation == generation and gate.broken then
			Game.buildGate(stage)
		end
	end)
end

function Game.tryGate(player: Player, stage: number): GateResult
	local state = states[player]
	local strength = statValue(player, "Strength").Value
	local needed = gateThreshold(stage)
	local function result(ok: boolean, reason: string): GateResult
		return { ok = ok, reason = reason, needed = needed, strength = strength, stage = stage }
	end
	if state == nil or gates[stage] == nil or state.winning then
		return result(false, "locked")
	end
	if stage <= state.checkpoint then
		return result(true, "passed")
	end
	if stage > state.checkpoint + 1 then
		return result(false, "locked")
	end
	if strength < needed then
		return result(false, "too weak")
	end
	state.checkpoint = stage
	shatter(stage)
	local position = headPosition(player)
	if position ~= nil then
		juice.popText(position, "Checkpoint!", Color3.fromRGB(120, 255, 140))
	end
	refreshAttributes(player)
	return result(true, "opened")
end

local function onGateTouched(stage: number, hit: BasePart)
	local player = playerFromHit(hit)
	local state = if player ~= nil then states[player] else nil
	if player == nil or state == nil or os.clock() - state.lastGateTouch < CONFIG.gateTouchCooldown then
		return
	end
	state.lastGateTouch = os.clock()
	local outcome = Game.tryGate(player, stage)
	if outcome.ok then
		return
	end
	local root = rootPart(player)
	if outcome.reason == "locked" then
		sendToCheckpoint(player)
		return
	end
	if root ~= nil then
		root.AssemblyLinearVelocity = Vector3.new(0, CONFIG.gateBounceLift, CONFIG.gateBounceSpeed)
	end
	local position = headPosition(player)
	if position ~= nil then
		juice.popText(position, `Need {formatNumber(outcome.needed)}`, Color3.fromRGB(255, 80, 80))
	end
end

function Game.buildGate(stage: number)
	local gate = gates[stage]
	if gate == nil then
		local folder = Instance.new("Folder")
		folder.Name = `Gate{stage}`
		folder.Parent = worldFolder
		gate = { folder = folder, broken = false, generation = 0, color = stageColor(stage) }
		gates[stage] = gate
	end
	gate.folder:ClearAllChildren()
	gate.broken = false
	gate.generation += 1
	local z = gateZ(stage)
	local brickWidth = CONFIG.trackWidth / CONFIG.gateColumns
	local brickHeight = CONFIG.gateHeight / CONFIG.gateRows
	for column = 1, CONFIG.gateColumns do
		for row = 1, CONFIG.gateRows do
			local shade = if (column + row) % 2 == 0 then gate.color else gate.color:Lerp(Color3.new(1, 1, 1), 0.25)
			local brick = newPart(
				gate.folder,
				"Brick",
				Vector3.new(brickWidth, brickHeight, CONFIG.gateThickness),
				CFrame.new(-CONFIG.trackWidth / 2 + (column - 0.5) * brickWidth, (row - 0.5) * brickHeight, z),
				shade,
				Enum.Material.Neon
			)
			brick.Touched:Connect(function(hit)
				onGateTouched(stage, hit)
			end)
		end
	end
	local sign = newPart(
		gate.folder,
		"Sign",
		Vector3.new(CONFIG.trackWidth, 9, 1),
		CFrame.new(0, CONFIG.gateHeight + 5, z),
		Color3.fromRGB(30, 30, 45),
		Enum.Material.SmoothPlastic
	)
	sign.CanCollide = false
	newBillboard(sign, formatNumber(gateThreshold(stage)), 26, 8, gate.color)
end

-- World ------------------------------------------------------------------------------------------------------

local function buildLighting()
	for _, child in Lighting:GetChildren() do
		if child.Name:sub(1, #CONFIG.folderName) == CONFIG.folderName then
			child:Destroy()
		end
	end
	Lighting.ClockTime = 14
	Lighting.Brightness = 3
	Lighting.Ambient = Color3.fromRGB(120, 130, 160)
	Lighting.OutdoorAmbient = Color3.fromRGB(150, 160, 190)
	Lighting.EnvironmentDiffuseScale = 1
	Lighting.EnvironmentSpecularScale = 1
	local atmosphere = Instance.new("Atmosphere")
	atmosphere.Name = `{CONFIG.folderName}Atmosphere`
	atmosphere.Density = 0.25
	atmosphere.Offset = 0.2
	atmosphere.Color = Color3.fromRGB(190, 225, 255)
	atmosphere.Decay = Color3.fromRGB(255, 220, 190)
	atmosphere.Glare = 0.2
	atmosphere.Haze = 1
	atmosphere.Parent = Lighting
	local correction = Instance.new("ColorCorrectionEffect")
	correction.Name = `{CONFIG.folderName}Color`
	correction.Saturation = 0.4
	correction.Contrast = 0.1
	correction.Parent = Lighting
	local bloom = Instance.new("BloomEffect")
	bloom.Name = `{CONFIG.folderName}Bloom`
	bloom.Intensity = 0.4
	bloom.Size = 24
	bloom.Threshold = 1.6
	bloom.Parent = Lighting
end

local function buildPad(parent: Instance, position: Vector3)
	local pad = newPart(
		parent,
		"TrainingPad",
		Vector3.new(CONFIG.padSize, 1, CONFIG.padSize),
		CFrame.new(position.X, 0.5, position.Z),
		CONFIG.padColor,
		Enum.Material.Neon
	)
	pad.CanCollide = false
	newBillboard(pad, `TRAIN x{CONFIG.padMultiplier}`, 10, 3, Color3.fromRGB(255, 255, 255))
	local board = pad:FindFirstChildOfClass("BillboardGui")
	if board ~= nil then
		board.StudsOffset = Vector3.new(0, 5, 0)
	end
	table.insert(padParts, pad)
end

local function buildOrb(parent: Instance, position: Vector3)
	local orb = newPart(
		parent,
		"StrengthOrb",
		Vector3.new(3, 3, 3),
		CFrame.new(position),
		Color3.fromRGB(255, 220, 60),
		Enum.Material.Neon
	)
	orb.Shape = Enum.PartType.Ball
	orb.CanCollide = false
	juice.bob(orb)
	juice.spin(orb)
	orb.Touched:Connect(function(hit)
		local player = playerFromHit(hit)
		if player == nil or orb.Transparency > 0 then
			return
		end
		orb.Transparency = 1
		orb.CanTouch = false
		local gained = Game.addStrength(player, CONFIG.orbStrength)
		juice.popText(orb.Position, `+{gained}`, Color3.fromRGB(255, 220, 60))
		juice.burst(orb.Position, Color3.fromRGB(255, 220, 60), 20)
		juice.pulse(player, CONFIG.strengthLabelName)
		task.delay(CONFIG.orbRespawnSeconds, function()
			orb.Transparency = 0
			orb.CanTouch = true
		end)
	end)
end

local function buildKillBrick(parent: Instance, z: number, startAtLeft: boolean)
	local size = CONFIG.killBrickSize
	local reach = CONFIG.trackWidth / 2 - size / 2
	local left = CFrame.new(-reach, size / 2, z)
	local right = CFrame.new(reach, size / 2, z)
	local brick = newPart(
		parent,
		"KillBrick",
		Vector3.new(size, size, size),
		if startAtLeft then left else right,
		CONFIG.killColor,
		Enum.Material.Neon
	)
	brick.Touched:Connect(function(hit)
		local player = playerFromHit(hit)
		local state = if player ~= nil then states[player] else nil
		if player ~= nil and state ~= nil and os.clock() - state.lastRespawn > CONFIG.killBrickRespawnSeconds then
			sendToCheckpoint(player)
		end
	end)
	local info = TweenInfo.new(CONFIG.killBrickSeconds, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)
	TweenService:Create(brick, info, { CFrame = if startAtLeft then right else left }):Play()
end

local function buildSegment(stage: number)
	local startZ = segmentStartZ(stage)
	local length = CONFIG.stageLength
	local color = stageColor(stage)
	local floorColor = color:Lerp(Color3.new(1, 1, 1), 0.35)
	local width = CONFIG.trackWidth
	local kind = stage % 3
	local folder = Instance.new("Folder")
	folder.Name = `Stage{stage}`
	folder.Parent = worldFolder

	local function floorPiece(fromZ: number, toZ: number)
		newPart(
			folder,
			"Floor",
			Vector3.new(width, 2, fromZ - toZ),
			CFrame.new(0, -1, (fromZ + toZ) / 2),
			floorColor,
			Enum.Material.SmoothPlastic
		)
	end
	if kind == 2 then
		local gapStart = startZ - length / 2 + CONFIG.gapLength / 2
		floorPiece(startZ, gapStart)
		floorPiece(gapStart - CONFIG.gapLength, startZ - length)
		buildOrb(folder, Vector3.new(0, 10, gapStart - CONFIG.gapLength / 2))
	else
		floorPiece(startZ, startZ - length)
	end
	for _, side in { -1, 1 } do
		local wall = newPart(
			folder,
			"Wall",
			Vector3.new(2, CONFIG.wallHeight, length),
			CFrame.new(side * (width / 2 + 1), CONFIG.wallHeight / 2, startZ - length / 2),
			color,
			Enum.Material.Glass
		)
		wall.Transparency = 0.4
	end
	if kind == 1 then
		buildKillBrick(folder, startZ - length * 0.4, true)
		buildKillBrick(folder, startZ - length * 0.65, false)
		buildOrb(folder, Vector3.new(0, 4, startZ - length * 0.52))
	elseif kind == 0 then
		buildPad(folder, Vector3.new(0, 0, startZ - 24))
		buildOrb(folder, Vector3.new(8, 4, startZ - length * 0.6))
	end
end

local function buildScenery(random: Random)
	local folder = Instance.new("Folder")
	folder.Name = "Scenery"
	folder.Parent = worldFolder
	local totalLength = CONFIG.lobbySize + CONFIG.stageCount * CONFIG.stageLength + CONFIG.finishLength
	for offset = 0, totalLength, CONFIG.scenerySpacing do
		local stage = math.clamp(math.ceil((offset - CONFIG.lobbySize / 2) / CONFIG.stageLength), 1, CONFIG.stageCount)
		for _, side in { -1, 1 } do
			local height = random:NextNumber(30, 70)
			local x = side * (CONFIG.trackWidth / 2 + random:NextNumber(14, 30))
			local pillar = newPart(
				folder,
				"Pillar",
				Vector3.new(random:NextNumber(8, 14), height, random:NextNumber(8, 14)),
				CFrame.new(x, height / 2 - CONFIG.voidDepth / 3, CONFIG.lobbySize / 2 - offset),
				stageColor(stage),
				Enum.Material.SmoothPlastic
			)
			pillar.Shape = if random:NextInteger(0, 1) == 0 then Enum.PartType.Cylinder else Enum.PartType.Block
			if pillar.Shape == Enum.PartType.Cylinder then
				pillar.CFrame = pillar.CFrame * CFrame.Angles(0, 0, math.rad(90))
				pillar.Size = Vector3.new(height, pillar.Size.Z, pillar.Size.Z)
			end
		end
	end
end

local function buildLobby()
	local folder = Instance.new("Folder")
	folder.Name = "Lobby"
	folder.Parent = worldFolder
	local size = CONFIG.lobbySize
	newPart(
		folder,
		"Floor",
		Vector3.new(size, 2, size),
		CFrame.new(0, -1, 0),
		Color3.fromRGB(110, 230, 120),
		Enum.Material.Grass
	)
	for _, side in { -1, 1 } do
		newPart(
			folder,
			"Wall",
			Vector3.new(2, CONFIG.wallHeight, size),
			CFrame.new(side * (size / 2 + 1), CONFIG.wallHeight / 2, 0),
			CONFIG.bandColors[1],
			Enum.Material.Glass
		).Transparency =
			0.4
	end
	newPart(
		folder,
		"BackWall",
		Vector3.new(size + 4, CONFIG.wallHeight, 2),
		CFrame.new(0, CONFIG.wallHeight / 2, size / 2 + 1),
		CONFIG.bandColors[1],
		Enum.Material.Glass
	).Transparency =
		0.4
	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "Spawn"
	spawn.Anchored = true
	spawn.Neutral = true
	spawn.Size = Vector3.new(8, 1, 8)
	spawn.CFrame = lobbySpawnCFrame() + Vector3.new(0, 0.5, 0)
	spawn.Color = Color3.fromRGB(255, 255, 255)
	spawn.Parent = folder
	buildPad(folder, Vector3.new(-size / 4, 0, -size / 6))
	buildPad(folder, Vector3.new(size / 4, 0, -size / 6))
	local title =
		newPart(folder, "Title", Vector3.new(1, 1, 1), CFrame.new(0, 24, -size / 2 + 4), Color3.new(1, 1, 1), nil)
	title.Transparency = 1
	title.CanCollide = false
	newBillboard(title, "+1 STRENGTH EVERY SECOND", 40, 7, Color3.fromRGB(255, 240, 90))
end

local function buildFinish()
	local folder = Instance.new("Folder")
	folder.Name = "Finish"
	folder.Parent = worldFolder
	local startZ = segmentStartZ(CONFIG.stageCount + 1)
	local length = CONFIG.finishLength
	local gold = CONFIG.bandColors[#CONFIG.bandColors]
	newPart(
		folder,
		"Floor",
		Vector3.new(CONFIG.trackWidth, 2, length),
		CFrame.new(0, -1, startZ - length / 2),
		gold:Lerp(Color3.new(1, 1, 1), 0.35),
		Enum.Material.SmoothPlastic
	)
	for _, side in { -1, 1 } do
		newPart(
			folder,
			"Wall",
			Vector3.new(2, CONFIG.wallHeight, length),
			CFrame.new(side * (CONFIG.trackWidth / 2 + 1), CONFIG.wallHeight / 2, startZ - length / 2),
			gold,
			Enum.Material.Glass
		).Transparency =
			0.4
	end
	newPart(
		folder,
		"EndWall",
		Vector3.new(CONFIG.trackWidth + 4, CONFIG.wallHeight, 2),
		CFrame.new(0, CONFIG.wallHeight / 2, startZ - length - 1),
		gold,
		Enum.Material.Glass
	).Transparency =
		0.4
	local archZ = startZ - length / 2
	archPosition = Vector3.new(0, 0, archZ)
	local pillarHeight = 22
	for _, side in { -1, 1 } do
		newPart(
			folder,
			"ArchPillar",
			Vector3.new(4, pillarHeight, 4),
			CFrame.new(side * (CONFIG.trackWidth / 2 - 3), pillarHeight / 2, archZ),
			gold,
			Enum.Material.Neon
		)
	end
	local beam = newPart(
		folder,
		"ArchBeam",
		Vector3.new(CONFIG.trackWidth, 8, 4),
		CFrame.new(0, pillarHeight + 2, archZ),
		gold,
		Enum.Material.Neon
	)
	newBillboard(beam, "WIN", 24, 8, Color3.new(1, 1, 1))
	local trigger = newPart(
		folder,
		"WinTrigger",
		Vector3.new(CONFIG.trackWidth, pillarHeight, 2),
		CFrame.new(0, pillarHeight / 2, archZ),
		Color3.new(1, 1, 1),
		nil
	)
	trigger.Transparency = 1
	trigger.CanCollide = false
	trigger.Touched:Connect(function(hit)
		local player = playerFromHit(hit)
		if player ~= nil then
			Game.finish(player)
		end
	end)
end

local function buildShots()
	local folder = Instance.new("Folder")
	folder.Name = "Shots"
	folder.Parent = worldFolder
	local trackEnd = segmentStartZ(CONFIG.stageCount + 1)
	local gateCenter = Vector3.new(0, CONFIG.gateHeight / 2 + 2, gateZ(CONFIG.shotGateStage))
	local views = {
		CFrame.lookAt(Vector3.new(34, 55, CONFIG.lobbySize / 2 + 20), Vector3.new(0, 4, trackEnd / 2)),
		CFrame.lookAt(gateCenter + Vector3.new(0, 8, 40), gateCenter),
		CFrame.lookAt(archPosition + Vector3.new(0, 16, 30), archPosition + Vector3.new(0, 10, 0)),
	}
	for index, view in views do
		local shot = newPart(folder, `Shot{index}`, Vector3.new(1, 1, 1), view, Color3.new(1, 1, 1), nil)
		shot.Transparency = 1
		shot.CanCollide = false
		shot.CanQuery = false
		shot.CanTouch = false
	end
end

local function buildWorld()
	local existing = workspace:FindFirstChild(CONFIG.folderName)
	if existing ~= nil then
		existing:Destroy()
	end
	table.clear(padParts)
	table.clear(gates)
	worldFolder = Instance.new("Folder")
	worldFolder.Name = CONFIG.folderName
	worldFolder.Parent = workspace
	buildLighting()
	buildLobby()
	for stage = 1, CONFIG.stageCount do
		buildSegment(stage)
		Game.buildGate(stage)
	end
	buildFinish()
	buildScenery(Random.new(CONFIG.seed))
	local voidPlane = newPart(
		worldFolder,
		"VoidPlane",
		Vector3.new(2000, 2, 2000),
		CFrame.new(0, -CONFIG.voidDepth, -CONFIG.stageCount * CONFIG.stageLength / 2),
		Color3.new(0, 0, 0),
		nil
	)
	voidPlane.Transparency = 1
	voidPlane.CanCollide = false
	voidPlane.Touched:Connect(function(hit)
		local player = playerFromHit(hit)
		if player ~= nil then
			sendToCheckpoint(player)
		end
	end)
	buildShots()
end

function Game.reformAllGates()
	for stage = 1, CONFIG.stageCount do
		Game.buildGate(stage)
	end
end

-- Win, rebirth ----------------------------------------------------------------------------------------------

local function returnToLobby(player: Player)
	local state = states[player]
	if state == nil then
		return
	end
	state.checkpoint = 0
	state.winning = false
	teleportTo(player, lobbySpawnCFrame())
	refreshAttributes(player)
end

-- Counts a Win once every gate is broken. The cutscene and fade run first unless `immediate` is true.
function Game.finish(player: Player, immediate: boolean?): ActionResult
	local state = states[player]
	if state == nil or state.winning then
		return { ok = false, reason = "busy" }
	end
	if state.checkpoint < CONFIG.stageCount then
		return { ok = false, reason = "gates remaining" }
	end
	state.winning = true
	statValue(player, "Wins").Value += 1
	local gold = CONFIG.bandColors[#CONFIG.bandColors]
	juice.burst(archPosition + Vector3.new(0, 14, 0), gold, 100)
	local position = headPosition(player)
	if position ~= nil then
		juice.popText(position, "WIN!", gold)
	end
	if immediate == true then
		returnToLobby(player)
		return { ok = true, reason = "won" }
	end
	local views = {}
	for _, offset in { Vector3.new(-30, 12, 40), Vector3.new(30, 20, 30), Vector3.new(0, 30, 50) } do
		table.insert(views, CFrame.lookAt(archPosition + offset, archPosition + Vector3.new(0, 12, 0)))
	end
	juice.cutscene(player, views, CONFIG.winCutsceneSeconds)
	task.delay(CONFIG.winCutsceneSeconds, function()
		juice.fade(player, CONFIG.fadeSeconds)
		task.wait(CONFIG.fadeSeconds / 2)
		returnToLobby(player)
	end)
	return { ok = true, reason = "won" }
end

function Game.rebirth(player: Player): ActionResult
	local state = states[player]
	if state == nil or state.winning then
		return { ok = false, reason = "busy" }
	end
	local rebirths = statValue(player, "Rebirths")
	local needed = rebirthWinsRequired(rebirths.Value)
	if statValue(player, "Wins").Value < needed then
		return { ok = false, reason = `needs {needed} Wins` }
	end
	rebirths.Value += 1
	statValue(player, "Strength").Value = 0
	state.checkpoint = 0
	teleportTo(player, lobbySpawnCFrame())
	refreshAttributes(player)
	local position = headPosition(player)
	if position ~= nil then
		juice.popText(position, `Rebirth x{multiplierFor(rebirths.Value)}`, Color3.fromRGB(255, 120, 200))
		juice.burst(position, CONFIG.padColor, 60)
	end
	return { ok = true, reason = "reborn" }
end

-- Players and start -------------------------------------------------------------------------------------------

local function addPlayer(player: Player)
	if states[player] ~= nil then
		return
	end
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	for _, name in { "Strength", "Wins", "Rebirths" } do
		local value = Instance.new("IntValue")
		value.Name = name
		value.Parent = leaderstats
	end
	leaderstats.Parent = player
	states[player] = { checkpoint = 0, winning = false, lastGateTouch = 0, lastRespawn = 0 }
	refreshAttributes(player)
	player.CharacterAdded:Connect(function(character)
		character:WaitForChild("HumanoidRootPart")
		local state = states[player]
		if state ~= nil then
			teleportTo(player, checkpointCFrame(state.checkpoint))
		end
	end)
end

local function runLoop()
	while true do
		task.wait(CONFIG.tickSeconds)
		if autoTick then
			for _, player in Players:GetPlayers() do
				if states[player] ~= nil then
					Game.tick(player, CONFIG.tickSeconds)
				end
			end
		end
	end
end

function Game.start()
	if started then
		return
	end
	started = true
	local module = ReplicatedStorage:WaitForChild("GameFormulaJuice", 10)
	if module == nil then
		error("ReplicatedStorage.GameFormulaJuice is missing; insert the juice template first")
	end
	juice = require(module)
	buildWorld()

	local remote = Instance.new("RemoteEvent")
	remote.Name = CONFIG.rebirthRemoteName
	remote.Parent = ReplicatedStorage
	remote.OnServerEvent:Connect(function(player)
		Game.rebirth(player)
	end)

	Players.PlayerAdded:Connect(addPlayer)
	Players.PlayerRemoving:Connect(function(player)
		states[player] = nil
	end)
	for _, player in Players:GetPlayers() do
		addPlayer(player)
	end
	task.spawn(runLoop)
end

return Game
