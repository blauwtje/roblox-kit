--!strict
-- "Steal an Egg" game logic. Put this ModuleScript next to StealEggMain.server in ServerScriptService, and
-- GameFormulaJuice in ReplicatedStorage. StealEggMain.server calls start() once; Checks.luau drives the same API.
-- The whole world lives in Workspace.GameFormulaStealEgg, so destroy() (or deleting that Folder) removes it.
local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

-- Contract of the GameFormulaJuice ModuleScript in ReplicatedStorage.
type Juice = {
	popText: (position: Vector3, text: string, color: Color3?) -> (),
	burst: (position: Vector3, color: Color3?, count: number?) -> (),
	spin: (part: BasePart, secondsPerTurn: number?) -> (),
	bob: (part: BasePart, height: number?) -> (),
	fade: (player: Player, seconds: number?) -> (),
	cutscene: (player: Player, cframes: { CFrame }, seconds: number) -> (),
	pulse: (player: Player, label: string) -> (),
}

type Rarity = {
	name: string,
	price: number,
	income: number, -- cash per second while the egg sits on a pad
	weight: number, -- relative chance on the conveyor
	color: Color3,
	neon: boolean,
}

-- Every tunable lives here.
local Config = {
	folderName = "GameFormulaStealEgg",
	remoteToastName = "StealEggToast",
	remoteRebirthName = "StealEggRebirth",
	hudLabelName = "CashLabel", -- the HUD label that Juice.pulse targets; the client script uses the same name

	maxPlots = 6,
	padsPerPlot = 6,
	padColumns = 3,
	padSpacing = 9,
	plotSize = Vector3.new(34, 1, 26),
	plotOffsetZ = 24, -- distance of the plot centres from the conveyor centre line
	plotSpacingX = 40,

	startCash = 100,
	rarities = {
		{ name = "Common", price = 50, income = 1, weight = 60, color = Color3.fromRGB(235, 235, 225), neon = false },
		{ name = "Uncommon", price = 250, income = 5, weight = 25, color = Color3.fromRGB(80, 220, 90), neon = false },
		{ name = "Rare", price = 1200, income = 22, weight = 10, color = Color3.fromRGB(60, 150, 255), neon = false },
		{ name = "Epic", price = 6000, income = 100, weight = 4, color = Color3.fromRGB(190, 80, 255), neon = true },
		{
			name = "Legendary",
			price = 30000,
			income = 500,
			weight = 1,
			color = Color3.fromRGB(255, 200, 30),
			neon = true,
		},
	} :: { Rarity },

	conveyorLength = 110,
	conveyorWidth = 10,
	conveyorSpeed = 9, -- studs per second
	spawnInterval = 2.5,
	maxConveyorEggs = 12,
	eggSize = Vector3.new(3, 4, 3),
	buyDistance = 12,
	eggFlightSeconds = 0.6,

	stealDistance = 14,
	carrySpeed = 9,
	carryHeight = 4.5,
	deliverRadius = 22,
	lockSeconds = 20,

	rebirthBaseCost = 20000,
	rebirthCostGrowth = 2.5,
	rebirthIncomeBonus = 0.5, -- added to the income multiplier per rebirth
	labelInterval = 0.25,

	bobHeight = 0.6,
	spinSeconds = 6,
	cutsceneSeconds = 9,
	cutsceneDelay = 3,
	juiceWaitSeconds = 10,

	-- Scenery around the bases, in studs. The yard is the fenced rectangle holding the plots and the conveyor.
	sceneSeed = 7,
	groundSize = Vector2.new(520, 420),
	yardMargin = 12, -- grass between the outer plot edges and the yard fence
	pathWidth = 8,
	fenceSpacing = 8,
	treeCount = 46,
	treeBand = 70, -- depth of the tree belt outside the fence
	bushCount = 40,
	flowerCount = 70,
	signPixelsPerStud = 40,
	grassColor = Color3.fromRGB(105, 205, 80),
	pathColor = Color3.fromRGB(245, 215, 150),
	fenceColor = Color3.fromRGB(255, 255, 255),
}

type PlacedEgg = { rarity: number, part: Part, prompt: ProximityPrompt }
type ConveyorEgg = { id: number, rarity: number, part: Part, prompt: ProximityPrompt }

export type Plot = {
	index: number,
	model: Model,
	center: Vector3,
	away: number, -- world Z direction pointing from the conveyor into the plot: -1 north, +1 south
	owner: Player?,
	ownerName: string?,
	fake: boolean,
	pads: { Part },
	eggs: { [number]: PlacedEgg },
	pending: number,
	lockRemaining: number,
	barrier: { Part },
	collectPad: Part,
	lockButton: Part,
	pile: Part,
	spawnCFrame: CFrame,
	signLabel: TextLabel,
	pendingLabel: TextLabel,
	lockLabel: TextLabel,
}

type Carry = { rarity: number, part: Part, origin: Plot, walkSpeed: number }

local StealEggGame = {}
StealEggGame.Config = Config

local rng = Random.new()
local folder: Folder? = nil
local shotsFolder: Folder? = nil
local plots: { Plot } = {}
local conveyorEggs: { [number]: ConveyorEgg } = {}
local stripes: { Part } = {}
local carrying: { [Player]: Carry } = {}
local nextEggId = 1
local spawnTimer = 0
local labelTimer = 0
local autoSpawn = true
local started = false
local juice: Juice? = nil
local toastRemote: RemoteEvent? = nil
local rebirthRemote: RemoteEvent? = nil
local lightingObjects: { Instance } = {}
local connections: { RBXScriptConnection } = {}
local welcomed: { [Player]: boolean } = {}

local function getJuice(): Juice?
	if juice == nil then
		local module = ReplicatedStorage:WaitForChild("GameFormulaJuice", Config.juiceWaitSeconds)
		if module ~= nil and module:IsA("ModuleScript") then
			juice = require(module) :: any
		else
			warn("StealEggGame: GameFormulaJuice not found in ReplicatedStorage; effects are skipped.")
		end
	end
	return juice
end

local function formatCash(amount: number): string
	local text = tostring(math.floor(amount + 0.5))
	local formatted = text:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	return (formatted:gsub("^,", ""))
end

local function toast(player: Player?, message: string)
	if player ~= nil and toastRemote ~= nil then
		toastRemote:FireClient(player, message)
	end
end

local function newPart(
	parent: Instance,
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
	part.Size = size
	part.CFrame = cframe
	part.Color = color
	part.Material = material
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	if shape ~= nil then
		part.Shape = shape
	end
	part.Parent = parent
	return part
end

local function newLabel(parent: Instance, text: string, studsSize: Vector2, color: Color3, offsetY: number): TextLabel
	local billboard = Instance.new("BillboardGui")
	billboard.Size = UDim2.fromScale(studsSize.X, studsSize.Y)
	billboard.StudsOffset = Vector3.new(0, offsetY, 0)
	billboard.MaxDistance = 90
	billboard.Parent = parent
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.Text = text
	label.TextColor3 = color
	label.TextStrokeTransparency = 0
	label.Parent = billboard
	return label
end

-- A board sign readable from the given face: bright rounded panel, coloured border and stroked text.
local function newSurfaceSign(board: BasePart, face: Enum.NormalId, text: string, color: Color3): TextLabel
	local gui = Instance.new("SurfaceGui")
	gui.Face = face
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = Config.signPixelsPerStud
	gui.LightInfluence = 0
	gui.Brightness = 1.2
	gui.Parent = board
	local panel = Instance.new("Frame")
	panel.Size = UDim2.fromScale(1, 1)
	panel.BackgroundColor3 = Color3.fromRGB(255, 252, 240)
	panel.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0.2, 0)
	corner.Parent = panel
	local border = Instance.new("UIStroke")
	border.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	border.Thickness = Config.signPixelsPerStud * 0.3
	border.Color = color
	border.Parent = panel
	local label = Instance.new("TextLabel")
	label.AnchorPoint = Vector2.new(0.5, 0.5)
	label.Position = UDim2.fromScale(0.5, 0.5)
	label.Size = UDim2.fromScale(0.9, 0.8)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.Text = text
	label.TextColor3 = color
	label.Parent = panel
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = Config.signPixelsPerStud * 0.08
	stroke.Color = Color3.fromRGB(40, 30, 60)
	stroke.Parent = label
	return label
end

local function cashValue(player: Player): NumberValue?
	local stats = player:FindFirstChild("leaderstats")
	local value = if stats ~= nil then stats:FindFirstChild("Cash") else nil
	if value ~= nil and value:IsA("NumberValue") then
		return value
	end
	return nil
end

local function rebirthValue(player: Player): NumberValue?
	local stats = player:FindFirstChild("leaderstats")
	local value = if stats ~= nil then stats:FindFirstChild("Rebirths") else nil
	if value ~= nil and value:IsA("NumberValue") then
		return value
	end
	return nil
end

function StealEggGame.getCash(player: Player): number
	local value = cashValue(player)
	return if value ~= nil then value.Value else 0
end

function StealEggGame.addCash(player: Player, amount: number)
	local value = cashValue(player)
	if value ~= nil then
		value.Value = math.max(0, value.Value + amount)
	end
end

function StealEggGame.getRebirths(player: Player): number
	local value = rebirthValue(player)
	return if value ~= nil then value.Value else 0
end

function StealEggGame.incomeMultiplier(player: Player?): number
	if player == nil then
		return 1
	end
	return 1 + StealEggGame.getRebirths(player) * Config.rebirthIncomeBonus
end

function StealEggGame.rebirthCost(rebirths: number): number
	return math.floor(Config.rebirthBaseCost * Config.rebirthCostGrowth ^ rebirths)
end

function StealEggGame.plotOf(player: Player): Plot?
	for _, plot in plots do
		if plot.owner == player then
			return plot
		end
	end
	return nil
end

function StealEggGame.getPlots(): { Plot }
	return plots
end

function StealEggGame.incomePerSecond(plot: Plot): number
	local total = 0
	for _, egg in plot.eggs do
		total += Config.rarities[egg.rarity].income
	end
	return total * StealEggGame.incomeMultiplier(plot.owner)
end

function StealEggGame.eggCount(plot: Plot): number
	local count = 0
	for _ in plot.eggs do
		count += 1
	end
	return count
end

function StealEggGame.isCarrying(player: Player): boolean
	return carrying[player] ~= nil
end

local function refreshPlayer(player: Player)
	local plot = StealEggGame.plotOf(player)
	player:SetAttribute("IncomePerSecond", if plot ~= nil then StealEggGame.incomePerSecond(plot) else 0)
	player:SetAttribute("Pending", if plot ~= nil then plot.pending else 0)
	player:SetAttribute("RebirthCost", StealEggGame.rebirthCost(StealEggGame.getRebirths(player)))
end

local function refreshPlot(plot: Plot)
	if plot.owner ~= nil then
		plot.signLabel.Text = plot.owner.DisplayName .. "'s Base"
	elseif plot.ownerName ~= nil then
		plot.signLabel.Text = plot.ownerName .. "'s Base"
	else
		plot.signLabel.Text = "Free Base"
	end
	plot.pendingLabel.Text = "$" .. formatCash(plot.pending)
	local locked = plot.lockRemaining > 0
	plot.lockLabel.Text = if locked then "LOCKED " .. tostring(math.ceil(plot.lockRemaining)) else "LOCK BASE"
	local pileSize = math.clamp(1 + math.log10(1 + plot.pending) * 1.1, 1, 7)
	plot.pile.Size = Vector3.new(pileSize, pileSize, pileSize)
	plot.pile.Position = plot.collectPad.Position + Vector3.new(0, 0.5 + pileSize / 2, 0)
	if plot.owner ~= nil then
		refreshPlayer(plot.owner)
	end
end

local function setBarrier(plot: Plot, locked: boolean)
	for _, wall in plot.barrier do
		wall.CanCollide = locked
		wall.Transparency = if locked then 0.55 else 1
	end
end

local function pickRarity(): number
	local total = 0
	for _, rarity in Config.rarities do
		total += rarity.weight
	end
	local roll = rng:NextNumber() * total
	for index, rarity in Config.rarities do
		roll -= rarity.weight
		if roll <= 0 then
			return index
		end
	end
	return 1
end

local function makeEggPart(parent: Instance, rarityIndex: number, name: string): Part
	local rarity = Config.rarities[rarityIndex]
	local egg = newPart(
		parent,
		name,
		Config.eggSize,
		CFrame.new(),
		rarity.color,
		if rarity.neon then Enum.Material.Neon else Enum.Material.SmoothPlastic,
		Enum.PartType.Ball
	)
	egg.CanCollide = false
	egg:SetAttribute("Rarity", rarity.name)
	local light = Instance.new("PointLight")
	light.Color = rarity.color
	light.Brightness = 0.8
	light.Range = 9
	light.Parent = egg
	return egg
end

local function eggRestPosition(plot: Plot, padIndex: number): Vector3
	return plot.pads[padIndex].Position + Vector3.new(0, 0.2 + Config.eggSize.Y / 2 + Config.bobHeight, 0)
end

local function freePad(plot: Plot): number?
	for index = 1, #plot.pads do
		if plot.eggs[index] == nil then
			return index
		end
	end
	return nil
end

local stealPromptHandler: (player: Player, plot: Plot, padIndex: number) -> ()

-- Creates the placed egg (a fresh Part, optionally tweened from startPosition) on a pad.
local function setEgg(plot: Plot, padIndex: number, rarityIndex: number, startPosition: Vector3?)
	local rarity = Config.rarities[rarityIndex]
	local part = makeEggPart(plot.model, rarityIndex, "PlacedEgg" .. tostring(padIndex))
	local target = eggRestPosition(plot, padIndex)
	part.Position = startPosition or target
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Steal"
	prompt.ObjectText = rarity.name .. " Egg"
	prompt.HoldDuration = 0.4
	prompt.MaxActivationDistance = Config.stealDistance
	prompt.RequiresLineOfSight = false
	prompt.Parent = part
	prompt.Triggered:Connect(function(player)
		stealPromptHandler(player, plot, padIndex)
	end)
	plot.eggs[padIndex] = { rarity = rarityIndex, part = part, prompt = prompt }

	local function settle()
		if part.Parent == nil then
			return
		end
		local effects = getJuice()
		if effects ~= nil then
			effects.spin(part, Config.spinSeconds)
			effects.bob(part, Config.bobHeight)
		end
	end
	if startPosition ~= nil then
		local tween = TweenService:Create(
			part,
			TweenInfo.new(Config.eggFlightSeconds, Enum.EasingStyle.Back, Enum.EasingDirection.Out),
			{ Position = target }
		)
		tween.Completed:Once(settle)
		tween:Play()
	else
		task.spawn(settle)
	end
end

local function removeEgg(plot: Plot, padIndex: number)
	local egg = plot.eggs[padIndex]
	if egg ~= nil then
		egg.part:Destroy()
		plot.eggs[padIndex] = nil
	end
end

local function conveyorPosition(x: number): Vector3
	return Vector3.new(x, 1 + Config.eggSize.Y / 2 + 0.3, 0)
end

-- Puts an egg at the start of the conveyor. rarityIndex forces the rarity (tests); otherwise it is weighted.
function StealEggGame.spawnEgg(rarityIndex: number?): number?
	if folder == nil then
		return nil
	end
	local index = rarityIndex or pickRarity()
	local rarity = Config.rarities[index]
	local id = nextEggId
	nextEggId += 1
	local part = makeEggPart(folder, index, "ConveyorEgg" .. tostring(id))
	part.Position = conveyorPosition(-Config.conveyorLength / 2)
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Buy $" .. formatCash(rarity.price)
	prompt.ObjectText = rarity.name .. " Egg"
	prompt.HoldDuration = 0
	prompt.MaxActivationDistance = Config.buyDistance
	prompt.RequiresLineOfSight = false
	prompt.Parent = part
	local label = newLabel(part, rarity.name .. "  $" .. formatCash(rarity.price), Vector2.new(9, 2), rarity.color, 3.2)
	label.TextScaled = true
	prompt.Triggered:Connect(function(player)
		local ok, reason = StealEggGame.buyEgg(player, id)
		if not ok then
			toast(player, reason)
		end
	end)
	conveyorEggs[id] = { id = id, rarity = index, part = part, prompt = prompt }
	return id
end

function StealEggGame.conveyorEggIds(): { number }
	local ids = {}
	for id in conveyorEggs do
		table.insert(ids, id)
	end
	table.sort(ids)
	return ids
end

function StealEggGame.rarityOfConveyorEgg(eggId: number): number?
	local egg = conveyorEggs[eggId]
	return if egg ~= nil then egg.rarity else nil
end

function StealEggGame.buyEgg(player: Player, eggId: number): (boolean, string)
	local plot = StealEggGame.plotOf(player)
	if plot == nil then
		return false, "You have no base."
	end
	local egg = conveyorEggs[eggId]
	if egg == nil then
		return false, "That egg is gone."
	end
	local rarity = Config.rarities[egg.rarity]
	if StealEggGame.getCash(player) < rarity.price then
		return false, "Not enough cash."
	end
	local padIndex = freePad(plot)
	if padIndex == nil then
		return false, "Your base is full."
	end
	StealEggGame.addCash(player, -rarity.price)
	local from = egg.part.Position
	conveyorEggs[eggId] = nil
	egg.part:Destroy()
	setEgg(plot, padIndex, egg.rarity, from)
	local effects = getJuice()
	if effects ~= nil then
		effects.burst(eggRestPosition(plot, padIndex), rarity.color, 24)
		effects.popText(eggRestPosition(plot, padIndex) + Vector3.new(0, 3, 0), "-$" .. formatCash(rarity.price))
	end
	refreshPlot(plot)
	return true, "bought"
end

local function attachCarry(player: Player, rarityIndex: number, origin: Plot): Carry
	local part = makeEggPart(workspace, rarityIndex, "CarriedEgg")
	if folder ~= nil then
		part.Parent = folder
	end
	part.Massless = true
	part.Size = Config.eggSize * 0.7
	local walkSpeed = 16
	local character = player.Character
	local root = if character ~= nil then character:FindFirstChild("HumanoidRootPart") else nil
	local humanoid = if character ~= nil then character:FindFirstChildOfClass("Humanoid") else nil
	if root ~= nil and root:IsA("BasePart") then
		part.Anchored = false
		part.CFrame = root.CFrame * CFrame.new(0, Config.carryHeight, 0)
		local weld = Instance.new("WeldConstraint")
		weld.Part0 = root
		weld.Part1 = part
		weld.Parent = part
	else
		part.Position = Vector3.new(0, -500, 0)
	end
	if humanoid ~= nil then
		walkSpeed = humanoid.WalkSpeed
		humanoid.WalkSpeed = Config.carrySpeed
	end
	return { rarity = rarityIndex, part = part, origin = origin, walkSpeed = walkSpeed }
end

local function releaseCarry(player: Player): Carry?
	local carry = carrying[player]
	if carry == nil then
		return nil
	end
	carrying[player] = nil
	carry.part:Destroy()
	local character = player.Character
	local humanoid = if character ~= nil then character:FindFirstChildOfClass("Humanoid") else nil
	if humanoid ~= nil then
		humanoid.WalkSpeed = carry.walkSpeed
	end
	return carry
end

function StealEggGame.steal(thief: Player, plot: Plot, padIndex: number): (boolean, string)
	local ownPlot = StealEggGame.plotOf(thief)
	if ownPlot == nil then
		return false, "You have no base."
	end
	if plot.owner == thief or ownPlot == plot then
		return false, "That is your own egg."
	end
	if carrying[thief] ~= nil then
		return false, "You are already carrying an egg."
	end
	if plot.lockRemaining > 0 then
		return false, "That base is locked."
	end
	local egg = plot.eggs[padIndex]
	if egg == nil then
		return false, "No egg there."
	end
	local rarityIndex = egg.rarity
	local rarity = Config.rarities[rarityIndex]
	local position = egg.part.Position
	removeEgg(plot, padIndex)
	carrying[thief] = attachCarry(thief, rarityIndex, plot)
	local effects = getJuice()
	if effects ~= nil then
		effects.burst(position, rarity.color, 30)
		effects.popText(position + Vector3.new(0, 3, 0), "Stolen!", Color3.fromRGB(255, 80, 80))
	end
	toast(plot.owner, "Your " .. rarity.name .. " egg was stolen!")
	refreshPlot(plot)
	return true, "stolen"
end

stealPromptHandler = function(player, plot, padIndex)
	local ok, reason = StealEggGame.steal(player, plot, padIndex)
	if not ok then
		toast(player, reason)
	end
end

-- Places the carried egg on a free pad of the carrier's own base.
function StealEggGame.deliver(player: Player): (boolean, string)
	local carry = carrying[player]
	local plot = StealEggGame.plotOf(player)
	if carry == nil or plot == nil then
		return false, "Nothing to deliver."
	end
	local padIndex = freePad(plot)
	if padIndex == nil then
		return false, "Your base is full."
	end
	local from = carry.part.Position
	releaseCarry(player)
	setEgg(plot, padIndex, carry.rarity, from)
	local effects = getJuice()
	if effects ~= nil then
		effects.burst(eggRestPosition(plot, padIndex), Config.rarities[carry.rarity].color, 40)
		effects.popText(eggRestPosition(plot, padIndex) + Vector3.new(0, 3, 0), "Got it!", Color3.fromRGB(255, 230, 80))
	end
	refreshPlot(plot)
	return true, "delivered"
end

-- A carried egg that cannot be delivered (death, leaving) goes back to the base it came from.
local function dropCarry(player: Player)
	local carry = releaseCarry(player)
	if carry == nil then
		return
	end
	local padIndex = freePad(carry.origin)
	if padIndex ~= nil and (carry.origin.owner ~= nil or carry.origin.fake) then
		setEgg(carry.origin, padIndex, carry.rarity, nil)
		refreshPlot(carry.origin)
	end
end

-- Banks the pending pile of the player's base into Cash and returns the amount.
function StealEggGame.collect(player: Player): number
	local plot = StealEggGame.plotOf(player)
	if plot == nil or plot.pending < 1 then
		return 0
	end
	local amount = math.floor(plot.pending)
	plot.pending -= amount
	StealEggGame.addCash(player, amount)
	local effects = getJuice()
	if effects ~= nil then
		local position = plot.collectPad.Position + Vector3.new(0, 4, 0)
		effects.popText(position, "+$" .. formatCash(amount), Color3.fromRGB(90, 255, 120))
		effects.burst(position, Color3.fromRGB(255, 220, 60), 20)
		effects.pulse(player, Config.hudLabelName)
	end
	refreshPlot(plot)
	return amount
end

-- Raises the barrier of a base for Config.lockSeconds. Returns false when it is already locked.
function StealEggGame.lockPlot(plot: Plot): boolean
	if plot.lockRemaining > 0 then
		return false
	end
	plot.lockRemaining = Config.lockSeconds
	setBarrier(plot, true)
	refreshPlot(plot)
	return true
end

function StealEggGame.lockBase(player: Player): (boolean, string)
	local plot = StealEggGame.plotOf(player)
	if plot == nil then
		return false, "You have no base."
	end
	if not StealEggGame.lockPlot(plot) then
		return false, "Already locked."
	end
	return true, "locked"
end

function StealEggGame.rebirth(player: Player): (boolean, string)
	local plot = StealEggGame.plotOf(player)
	local value = rebirthValue(player)
	if plot == nil or value == nil then
		return false, "You have no base."
	end
	local cost = StealEggGame.rebirthCost(value.Value)
	if StealEggGame.getCash(player) < cost then
		return false, "You need $" .. formatCash(cost) .. " to rebirth."
	end
	dropCarry(player)
	for padIndex in plot.eggs do
		removeEgg(plot, padIndex)
	end
	plot.pending = 0
	local cash = cashValue(player)
	if cash ~= nil then
		cash.Value = Config.startCash
	end
	value.Value += 1
	local effects = getJuice()
	if effects ~= nil then
		effects.fade(player, 1.2)
		effects.burst(plot.center + Vector3.new(0, 6, 0), Color3.fromRGB(255, 120, 255), 60)
		effects.popText(
			plot.center + Vector3.new(0, 10, 0),
			"REBIRTH x" .. tostring(StealEggGame.incomeMultiplier(player)),
			Color3.fromRGB(255, 120, 255)
		)
		effects.pulse(player, Config.hudLabelName)
	end
	refreshPlot(plot)
	return true, "rebirthed"
end

-- Advances the world by `seconds`: conveyor, spawner, income, locks, carried-egg delivery and labels.
function StealEggGame.tick(seconds: number)
	-- Conveyor.
	local endX = Config.conveyorLength / 2
	for id, egg in conveyorEggs do
		local position = egg.part.Position
		local x = position.X + Config.conveyorSpeed * seconds
		if x >= endX then
			conveyorEggs[id] = nil
			egg.part:Destroy()
		else
			egg.part.Position = Vector3.new(x, position.Y, position.Z)
		end
	end
	for _, stripe in stripes do
		local x = stripe.Position.X + Config.conveyorSpeed * seconds
		if x >= endX then
			x -= Config.conveyorLength
		end
		stripe.Position = Vector3.new(x, stripe.Position.Y, stripe.Position.Z)
	end
	if autoSpawn then
		spawnTimer += seconds
		while spawnTimer >= Config.spawnInterval do
			spawnTimer -= Config.spawnInterval
			local count = 0
			for _ in conveyorEggs do
				count += 1
			end
			if count < Config.maxConveyorEggs then
				StealEggGame.spawnEgg(nil)
			end
		end
	end

	-- Income and locks.
	for _, plot in plots do
		if plot.owner ~= nil or plot.fake then
			plot.pending += StealEggGame.incomePerSecond(plot) * seconds
		end
		if plot.lockRemaining > 0 then
			plot.lockRemaining = math.max(0, plot.lockRemaining - seconds)
			if plot.lockRemaining == 0 then
				setBarrier(plot, false)
			end
		end
	end

	-- Carried eggs are placed on reaching the own base.
	for player in carrying do
		local plot = StealEggGame.plotOf(player)
		local character = player.Character
		local root = if character ~= nil then character:FindFirstChild("HumanoidRootPart") else nil
		if plot ~= nil and root ~= nil and root:IsA("BasePart") then
			if (root.Position - plot.center).Magnitude <= Config.deliverRadius then
				StealEggGame.deliver(player)
			end
		end
	end

	labelTimer += seconds
	if labelTimer >= Config.labelInterval then
		labelTimer = 0
		for _, plot in plots do
			refreshPlot(plot)
		end
	end
end

function StealEggGame.setAutoSpawn(enabled: boolean)
	autoSpawn = enabled
end

function StealEggGame.clearConveyor()
	for id, egg in conveyorEggs do
		egg.part:Destroy()
		conveyorEggs[id] = nil
	end
end

-- Claims a free plot for a pretend owner that has no Player (used by tests and demos).
function StealEggGame.claimFakePlot(name: string): Plot?
	for _, plot in plots do
		if plot.owner == nil and not plot.fake then
			plot.fake = true
			plot.ownerName = name
			refreshPlot(plot)
			return plot
		end
	end
	return nil
end

function StealEggGame.placeEgg(plot: Plot, rarityIndex: number): number?
	local padIndex = freePad(plot)
	if padIndex == nil then
		return nil
	end
	setEgg(plot, padIndex, rarityIndex, nil)
	refreshPlot(plot)
	return padIndex
end

function StealEggGame.releasePlot(plot: Plot)
	for padIndex in plot.eggs do
		removeEgg(plot, padIndex)
	end
	plot.owner = nil
	plot.ownerName = nil
	plot.fake = false
	plot.pending = 0
	plot.lockRemaining = 0
	setBarrier(plot, false)
	refreshPlot(plot)
end

function StealEggGame.shotCFrames(): { CFrame }
	local result = {}
	if shotsFolder ~= nil then
		for index = 1, 3 do
			local shot = shotsFolder:FindFirstChild("Shot" .. tostring(index))
			if shot ~= nil and shot:IsA("BasePart") then
				table.insert(result, shot.CFrame)
			end
		end
	end
	return result
end

-- Points Shot2 at the given base for a close-up.
function StealEggGame.focusShot(plot: Plot)
	local shot = if shotsFolder ~= nil then shotsFolder:FindFirstChild("Shot2") else nil
	if shot ~= nil and shot:IsA("BasePart") then
		local target = plot.center + Vector3.new(0, 3, 0)
		-- Look from the lane side over the pads.
		local eye = target + Vector3.new(10, 15, -plot.away * 20)
		shot.CFrame = CFrame.lookAt(eye, target)
	end
end

----------------------------------------------------------------------------------------------------------------------
-- World building
----------------------------------------------------------------------------------------------------------------------

local plotColors = {
	Color3.fromRGB(255, 120, 150),
	Color3.fromRGB(120, 200, 255),
	Color3.fromRGB(255, 200, 90),
	Color3.fromRGB(150, 230, 120),
	Color3.fromRGB(200, 150, 255),
	Color3.fromRGB(255, 160, 90),
}

local function buildPlot(parent: Instance, index: number): Plot
	local column = (index - 1) % 3
	local north = index <= 3
	local away = if north then -1 else 1 -- world Z direction pointing away from the lane
	local center = Vector3.new((column - 1) * Config.plotSpacingX, 0.5, away * Config.plotOffsetZ)
	local color = plotColors[index]
	local model = Instance.new("Model")
	model.Name = "Plot" .. tostring(index)
	model.Parent = parent
	local size = Config.plotSize
	newPart(model, "Floor", size, CFrame.new(center), color, Enum.Material.SmoothPlastic, nil)
	local rim = Color3.new(1, 1, 1)
	newPart(
		model,
		"Rim",
		Vector3.new(size.X + 2, 0.6, size.Z + 2),
		CFrame.new(center - Vector3.new(0, 0.3, 0)),
		rim,
		Enum.Material.SmoothPlastic,
		nil
	)

	-- Pad grid: rows go away from the lane.
	local pads: { Part } = {}
	for padIndex = 1, Config.padsPerPlot do
		local padColumn = (padIndex - 1) % Config.padColumns
		local row = (padIndex - 1) // Config.padColumns
		local offset = Vector3.new(
			(padColumn - (Config.padColumns - 1) / 2) * Config.padSpacing,
			0.7,
			away * (2 + row * Config.padSpacing * 0.8)
		)
		local pad = newPart(
			model,
			"Pad" .. tostring(padIndex),
			Vector3.new(0.4, 6.5, 6.5),
			CFrame.new(center + offset) * CFrame.Angles(0, 0, math.pi / 2),
			Color3.fromRGB(255, 255, 255),
			Enum.Material.SmoothPlastic,
			Enum.PartType.Cylinder
		)
		newPart(
			model,
			"PadGlow" .. tostring(padIndex),
			Vector3.new(0.2, 5, 5),
			CFrame.new(center + offset + Vector3.new(0, 0.25, 0)) * CFrame.Angles(0, 0, math.pi / 2),
			color,
			Enum.Material.Neon,
			Enum.PartType.Cylinder
		)
		table.insert(pads, pad)
	end

	-- Collect pad and lock button sit between the pads and the lane.
	local frontZ = -away * 8.5
	local collectPad = newPart(
		model,
		"CollectPad",
		Vector3.new(0.5, 8, 8),
		CFrame.new(center + Vector3.new(-9, 0.75, frontZ)) * CFrame.Angles(0, 0, math.pi / 2),
		Color3.fromRGB(70, 220, 100),
		Enum.Material.Neon,
		Enum.PartType.Cylinder
	)
	local pile = newPart(
		model,
		"Pile",
		Vector3.new(1, 1, 1),
		CFrame.new(collectPad.Position + Vector3.new(0, 1, 0)),
		Color3.fromRGB(255, 215, 50),
		Enum.Material.Neon,
		Enum.PartType.Ball
	)
	pile.CanCollide = false
	local pendingLabel = newLabel(collectPad, "$0", Vector2.new(8, 2.5), Color3.fromRGB(255, 240, 120), 6)
	newLabel(collectPad, "COLLECT", Vector2.new(6, 1.6), Color3.new(1, 1, 1), 8.5)

	local lockButton = newPart(
		model,
		"LockButton",
		Vector3.new(0.8, 5, 5),
		CFrame.new(center + Vector3.new(9, 1, frontZ)) * CFrame.Angles(0, 0, math.pi / 2),
		Color3.fromRGB(255, 70, 70),
		Enum.Material.Neon,
		Enum.PartType.Cylinder
	)
	local lockLabel = newLabel(lockButton, "LOCK BASE", Vector2.new(8, 2), Color3.new(1, 1, 1), 4)
	local lockPrompt = Instance.new("ProximityPrompt")
	lockPrompt.ActionText = "Lock base"
	lockPrompt.ObjectText = "Barrier"
	lockPrompt.HoldDuration = 0
	lockPrompt.MaxActivationDistance = 10
	lockPrompt.RequiresLineOfSight = false
	lockPrompt.Parent = lockButton

	local signPost = newPart(
		model,
		"SignPost",
		Vector3.new(1, 8, 1),
		CFrame.new(center + Vector3.new(0, 4.5, away * (size.Z / 2 - 1))),
		Color3.fromRGB(90, 70, 60),
		Enum.Material.SmoothPlastic,
		Enum.PartType.Cylinder
	)
	signPost.CFrame = CFrame.new(signPost.Position) * CFrame.Angles(0, 0, math.pi / 2)
	local signBoard = newPart(
		model,
		"SignBoard",
		Vector3.new(16, 4, 0.6),
		CFrame.new(center + Vector3.new(0, 10, away * (size.Z / 2 - 1))),
		color,
		Enum.Material.SmoothPlastic,
		nil
	)
	-- The sign faces the lane: an unrotated part's Front face points -Z.
	local signLabel =
		newSurfaceSign(signBoard, if away < 0 then Enum.NormalId.Back else Enum.NormalId.Front, "Free Base", color)

	-- Barrier walls around the plot, off until the base is locked.
	local barrier: { Part } = {}
	local wallHeight = 12
	local halfX = size.X / 2 + 1
	local halfZ = size.Z / 2 + 1
	local walls = {
		{ Vector3.new(size.X + 2, wallHeight, 0.6), Vector3.new(0, 0, halfZ) },
		{ Vector3.new(size.X + 2, wallHeight, 0.6), Vector3.new(0, 0, -halfZ) },
		{ Vector3.new(0.6, wallHeight, size.Z + 2), Vector3.new(halfX, 0, 0) },
		{ Vector3.new(0.6, wallHeight, size.Z + 2), Vector3.new(-halfX, 0, 0) },
	}
	for wallIndex, wall in walls do
		local part = newPart(
			model,
			"Barrier" .. tostring(wallIndex),
			wall[1],
			CFrame.new(center + Vector3.new(wall[2].X, wallHeight / 2, wall[2].Z)),
			Color3.fromRGB(120, 200, 255),
			Enum.Material.ForceField,
			nil
		)
		part.CanCollide = false
		part.Transparency = 1
		table.insert(barrier, part)
	end

	local plot: Plot = {
		index = index,
		model = model,
		center = center,
		away = away,
		owner = nil,
		ownerName = nil,
		fake = false,
		pads = pads,
		eggs = {},
		pending = 0,
		lockRemaining = 0,
		barrier = barrier,
		collectPad = collectPad,
		lockButton = lockButton,
		pile = pile,
		spawnCFrame = CFrame.new(center + Vector3.new(0, 4, -away * 10), center + Vector3.new(0, 4, away * 10)),
		signLabel = signLabel,
		pendingLabel = pendingLabel,
		lockLabel = lockLabel,
	}

	collectPad.Touched:Connect(function(other)
		local character = other.Parent
		local player = if character ~= nil then Players:GetPlayerFromCharacter(character) else nil
		if player ~= nil and plot.owner == player then
			StealEggGame.collect(player)
		end
	end)
	lockPrompt.Triggered:Connect(function(player)
		if plot.owner ~= player then
			return
		end
		local ok, reason = StealEggGame.lockBase(player)
		if not ok then
			toast(player, reason)
		end
	end)
	return plot
end

local function buildConveyor(parent: Instance)
	newPart(
		parent,
		"Conveyor",
		Vector3.new(Config.conveyorLength + 4, 1, Config.conveyorWidth),
		CFrame.new(0, 0.5, 0),
		Color3.fromRGB(55, 58, 75),
		Enum.Material.SmoothPlastic,
		nil
	)
	for _, side in { -1, 1 } do
		newPart(
			parent,
			"ConveyorEdge",
			Vector3.new(Config.conveyorLength + 4, 0.4, 0.6),
			CFrame.new(0, 1.1, side * (Config.conveyorWidth / 2 + 0.3)),
			Color3.fromRGB(0, 230, 255),
			Enum.Material.Neon,
			nil
		)
	end
	local stripeCount = 14
	for index = 1, stripeCount do
		local x = -Config.conveyorLength / 2 + (index - 1) * (Config.conveyorLength / stripeCount)
		local stripe = newPart(
			parent,
			"Stripe",
			Vector3.new(1.2, 0.1, Config.conveyorWidth - 2),
			CFrame.new(x, 1.05, 0),
			Color3.fromRGB(90, 95, 125),
			Enum.Material.SmoothPlastic,
			nil
		)
		stripe.CanCollide = false
		table.insert(stripes, stripe)
	end
	local gate = newPart(
		parent,
		"Sign",
		Vector3.new(24, 6, 0.8),
		CFrame.new(-Config.conveyorLength / 2 - 4, 8, 0) * CFrame.Angles(0, math.pi / 2, 0),
		Color3.fromRGB(30, 30, 50),
		Enum.Material.SmoothPlastic,
		nil
	)
	newLabel(gate, "STEAL AN EGG", Vector2.new(24, 6), Color3.fromRGB(255, 220, 60), 0)
	for _, side in { -1, 1 } do
		newPart(
			parent,
			"SignLeg",
			Vector3.new(1.2, 8, 1.2),
			CFrame.new(-Config.conveyorLength / 2 - 4, 4, side * 12),
			Color3.fromRGB(255, 90, 90),
			Enum.Material.SmoothPlastic,
			nil
		)
	end
end

local function yardHalfSize(): Vector2
	local halfX = Config.plotSpacingX + Config.plotSize.X / 2 + Config.yardMargin
	local halfZ = Config.plotOffsetZ + Config.plotSize.Z / 2 + Config.yardMargin
	return Vector2.new(halfX, halfZ)
end

local function flatStrip(parent: Instance, name: string, from: Vector2, to: Vector2, width: number, color: Color3)
	local delta = to - from
	local middle = (from + to) / 2
	local part = newPart(
		parent,
		name,
		Vector3.new(width, 0.2, delta.Magnitude + width),
		CFrame.lookAt(Vector3.new(middle.X, 0.08, middle.Y), Vector3.new(to.X, 0.08, to.Y)),
		color,
		Enum.Material.Sand,
		nil
	)
	part.CanCollide = false
end

local function buildTree(parent: Instance, random: Random, position: Vector3, scale: number)
	local height = 8 * scale
	newPart(
		parent,
		"Trunk",
		Vector3.new(height, 1.8 * scale, 1.8 * scale),
		CFrame.new(position + Vector3.new(0, height / 2, 0)) * CFrame.Angles(0, 0, math.pi / 2),
		Color3.fromRGB(150, 100, 60),
		Enum.Material.Wood,
		Enum.PartType.Cylinder
	)
	local hue = random:NextNumber(0.24, 0.36)
	local crown = 8 * scale
	newPart(
		parent,
		"Crown",
		Vector3.new(crown, crown, crown),
		CFrame.new(position + Vector3.new(0, height + crown * 0.25, 0)),
		Color3.fromHSV(hue, 0.75, 0.8),
		Enum.Material.SmoothPlastic,
		Enum.PartType.Ball
	)
	newPart(
		parent,
		"CrownTop",
		Vector3.new(crown * 0.7, crown * 0.7, crown * 0.7),
		CFrame.new(position + Vector3.new(crown * 0.15, height + crown * 0.7, -crown * 0.1)),
		Color3.fromHSV(hue - 0.03, 0.65, 0.95),
		Enum.Material.SmoothPlastic,
		Enum.PartType.Ball
	)
end

-- A random point on the ground outside the yard fence, within the tree belt.
local function outsidePoint(random: Random, half: Vector2, band: number): Vector3
	local ground = Config.groundSize / 2
	for _ = 1, 20 do
		local x = random:NextNumber(-math.min(ground.X, half.X + band), math.min(ground.X, half.X + band))
		local z = random:NextNumber(-math.min(ground.Y, half.Y + band), math.min(ground.Y, half.Y + band))
		if math.abs(x) > half.X + 4 or math.abs(z) > half.Y + 4 then
			return Vector3.new(x, 0, z)
		end
	end
	return Vector3.new(half.X + band / 2, 0, 0)
end

-- Grass, a fenced yard with sand paths around the bases, arches over the conveyor ends and a belt of trees,
-- bushes and flowers outside the fence. Everything is placed from Config, so it follows the plot layout.
local function buildScenery(parent: Instance)
	newPart(
		parent,
		"Ground",
		Vector3.new(Config.groundSize.X, 1, Config.groundSize.Y),
		CFrame.new(0, -0.5, 0),
		Config.grassColor,
		Enum.Material.Grass,
		nil
	)
	local scenery = Instance.new("Folder")
	scenery.Name = "Scenery"
	scenery.Parent = parent
	local random = Random.new(Config.sceneSeed)
	local half = yardHalfSize()
	local ring = half - Vector2.new(Config.pathWidth / 2 + 2, Config.pathWidth / 2 + 2)

	-- Ring path inside the fence, lanes between plot columns, and paths from the conveyor ends to the gates.
	local corners = {
		Vector2.new(-ring.X, -ring.Y),
		Vector2.new(ring.X, -ring.Y),
		Vector2.new(ring.X, ring.Y),
		Vector2.new(-ring.X, ring.Y),
	}
	for index, corner in corners do
		flatStrip(scenery, "Path", corner, corners[index % 4 + 1], Config.pathWidth, Config.pathColor)
	end
	local laneWidth = math.max(2, Config.plotSpacingX - Config.plotSize.X - 2)
	for column = 1, 2 do
		local x = (column - 1.5) * Config.plotSpacingX
		for _, side in { -1, 1 } do
			flatStrip(
				scenery,
				"Lane",
				Vector2.new(x, side * (Config.conveyorWidth / 2 + 1)),
				Vector2.new(x, side * ring.Y),
				laneWidth,
				Config.pathColor
			)
		end
	end
	for _, side in { -1, 1 } do
		flatStrip(
			scenery,
			"GatePath",
			Vector2.new(side * (Config.conveyorLength / 2 + 2), 0),
			Vector2.new(side * (Config.groundSize.X / 2), 0),
			Config.pathWidth,
			Config.pathColor
		)
	end

	-- Picket fence around the yard, open where the gate paths leave.
	local gateHalf = Config.pathWidth / 2 + 2
	local function fenceLine(from: Vector2, to: Vector2)
		local delta = to - from
		local count = math.max(1, math.floor(delta.Magnitude / Config.fenceSpacing))
		for step = 0, count do
			local point = from + delta * (step / count)
			if math.abs(point.Y) > gateHalf or math.abs(point.X) < half.X - 1 then
				newPart(
					scenery,
					"FencePost",
					Vector3.new(0.8, 3.6, 0.8),
					CFrame.new(point.X, 1.8, point.Y),
					Config.fenceColor,
					Enum.Material.SmoothPlastic,
					nil
				)
			end
			if step < count then
				local next = from + delta * ((step + 1) / count)
				local middle = (point + next) / 2
				if math.abs(middle.Y) > gateHalf or math.abs(middle.X) < half.X - 1 then
					for _, height in { 1.2, 2.6 } do
						newPart(
							scenery,
							"FenceRail",
							Vector3.new(0.3, 0.45, (next - point).Magnitude),
							CFrame.lookAt(Vector3.new(middle.X, height, middle.Y), Vector3.new(next.X, height, next.Y)),
							Config.fenceColor,
							Enum.Material.SmoothPlastic,
							nil
						)
					end
				end
			end
		end
	end
	local fenceCorners = {
		Vector2.new(-half.X, -half.Y),
		Vector2.new(half.X, -half.Y),
		Vector2.new(half.X, half.Y),
		Vector2.new(-half.X, half.Y),
	}
	for index, corner in fenceCorners do
		fenceLine(corner, fenceCorners[index % 4 + 1])
	end

	-- Striped arches over both conveyor ends: where the eggs come from and where they leave.
	for _, side in { -1, 1 } do
		local x = side * (Config.conveyorLength / 2 + 1)
		for _, edge in { -1, 1 } do
			newPart(
				scenery,
				"ArchPost",
				Vector3.new(1.6, 11, 1.6),
				CFrame.new(x, 5.5, edge * (Config.conveyorWidth / 2 + 1.5)),
				Color3.fromRGB(255, 90, 150),
				Enum.Material.SmoothPlastic,
				nil
			)
		end
		newPart(
			scenery,
			"ArchBeam",
			Vector3.new(2.4, 2.4, Config.conveyorWidth + 5),
			CFrame.new(x, 11, 0),
			Color3.fromRGB(255, 210, 60),
			Enum.Material.SmoothPlastic,
			nil
		)
	end

	-- Tree belt, bushes along the fence and flower clumps on the open grass.
	for _ = 1, Config.treeCount do
		buildTree(scenery, random, outsidePoint(random, half, Config.treeBand), random:NextNumber(0.9, 1.5))
	end
	for _ = 1, Config.bushCount do
		local position = outsidePoint(random, half, 10)
		local size = random:NextNumber(3, 5)
		newPart(
			scenery,
			"Bush",
			Vector3.new(size * 1.4, size, size * 1.4),
			CFrame.new(position + Vector3.new(0, size * 0.3, 0)),
			Color3.fromHSV(random:NextNumber(0.26, 0.34), 0.7, 0.75),
			Enum.Material.SmoothPlastic,
			Enum.PartType.Ball
		)
	end
	local petals = {
		Color3.fromRGB(255, 120, 170),
		Color3.fromRGB(255, 230, 80),
		Color3.fromRGB(255, 255, 255),
		Color3.fromRGB(170, 120, 255),
	}
	for _ = 1, Config.flowerCount do
		local position = outsidePoint(random, half, Config.treeBand)
		local color = petals[random:NextInteger(1, #petals)]
		for _ = 1, 3 do
			local offset = Vector3.new(random:NextNumber(-1.5, 1.5), 0.5, random:NextNumber(-1.5, 1.5))
			newPart(
				scenery,
				"Flower",
				Vector3.new(1, 1, 1),
				CFrame.new(position + offset),
				color,
				Enum.Material.SmoothPlastic,
				Enum.PartType.Ball
			).CanCollide =
				false
		end
	end
end

local function buildShots(parent: Instance)
	local shots = Instance.new("Folder")
	shots.Name = "Shots"
	shots.Parent = parent
	shotsFolder = shots
	local views = {
		CFrame.lookAt(Vector3.new(0, 62, 100), Vector3.new(0, 0, -4)),
		CFrame.lookAt(Vector3.new(10, 16, -3), Vector3.new(0, 3, -24)),
		CFrame.lookAt(Vector3.new(-50, 9, 13), Vector3.new(-10, 3, 0)),
	}
	for index, view in views do
		local shot = newPart(
			shots,
			"Shot" .. tostring(index),
			Vector3.new(1, 1, 1),
			view,
			Color3.new(1, 1, 1),
			Enum.Material.SmoothPlastic,
			nil
		)
		shot.Transparency = 1
		shot.CanCollide = false
		shot.CanQuery = false
		shot.CanTouch = false
	end
end

local function setupLighting()
	Lighting.ClockTime = 14
	Lighting.Brightness = 3
	Lighting.Ambient = Color3.fromRGB(150, 160, 185)
	Lighting.OutdoorAmbient = Color3.fromRGB(160, 170, 195)
	Lighting.GeographicLatitude = 30
	Lighting.EnvironmentDiffuseScale = 0.6
	Lighting.EnvironmentSpecularScale = 0.3
	local atmosphere = Instance.new("Atmosphere")
	atmosphere.Name = "GameFormulaStealEggAtmosphere"
	atmosphere.Density = 0.3
	atmosphere.Offset = 0.25
	atmosphere.Color = Color3.fromRGB(190, 225, 255)
	atmosphere.Decay = Color3.fromRGB(150, 200, 255)
	atmosphere.Glare = 0.3
	atmosphere.Haze = 0.8
	atmosphere.Parent = Lighting
	local sky = Instance.new("Sky")
	sky.Name = "GameFormulaStealEggSky"
	sky.SunAngularSize = 14
	sky.Parent = Lighting
	local sunRays = Instance.new("SunRaysEffect")
	sunRays.Name = "GameFormulaStealEggSunRays"
	sunRays.Intensity = 0.06
	sunRays.Spread = 0.6
	sunRays.Parent = Lighting
	local clouds = Instance.new("Clouds")
	clouds.Name = "GameFormulaStealEggClouds"
	clouds.Cover = 0.55
	clouds.Density = 0.6
	clouds.Color = Color3.new(1, 1, 1)
	clouds.Parent = workspace.Terrain
	local correction = Instance.new("ColorCorrectionEffect")
	correction.Name = "GameFormulaStealEggColor"
	correction.Saturation = 0.3
	correction.Contrast = 0.12
	correction.Brightness = 0.02
	correction.Parent = Lighting
	local bloom = Instance.new("BloomEffect")
	bloom.Name = "GameFormulaStealEggBloom"
	bloom.Intensity = 0.4
	bloom.Size = 24
	bloom.Threshold = 1.6
	bloom.Parent = Lighting
	lightingObjects = { atmosphere, correction, bloom, sky, sunRays, clouds }
end

local function buildWorld()
	local existing = workspace:FindFirstChild(Config.folderName)
	if existing ~= nil then
		existing:Destroy()
	end
	local root = Instance.new("Folder")
	root.Name = Config.folderName
	root.Parent = workspace
	folder = root
	plots = {}
	stripes = {}
	conveyorEggs = {}
	buildScenery(root)
	buildConveyor(root)
	for index = 1, Config.maxPlots do
		table.insert(plots, buildPlot(root, index))
	end
	buildShots(root)
	setupLighting()
end

----------------------------------------------------------------------------------------------------------------------
-- Players
----------------------------------------------------------------------------------------------------------------------

local function onCharacterAdded(player: Player, character: Model)
	local plot = StealEggGame.plotOf(player)
	if plot ~= nil then
		task.defer(function()
			if character.Parent ~= nil then
				character:PivotTo(plot.spawnCFrame)
			end
		end)
	end
	local humanoid = character:WaitForChild("Humanoid", 10)
	if humanoid ~= nil and humanoid:IsA("Humanoid") then
		humanoid.Died:Connect(function()
			dropCarry(player)
		end)
	end
	if not welcomed[player] then
		welcomed[player] = true
		task.delay(Config.cutsceneDelay, function()
			local effects = getJuice()
			local frames = StealEggGame.shotCFrames()
			if effects ~= nil and player.Parent ~= nil and #frames > 0 then
				effects.cutscene(player, frames, Config.cutsceneSeconds)
			end
		end)
	end
end

local function onPlayerAdded(player: Player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	local cash = Instance.new("NumberValue")
	cash.Name = "Cash"
	cash.Value = Config.startCash
	cash.Parent = stats
	local rebirths = Instance.new("NumberValue")
	rebirths.Name = "Rebirths"
	rebirths.Value = 0
	rebirths.Parent = stats
	stats.Parent = player

	for _, plot in plots do
		if plot.owner == nil and not plot.fake then
			plot.owner = player
			refreshPlot(plot)
			break
		end
	end
	if StealEggGame.plotOf(player) == nil then
		warn("StealEggGame: no free base for " .. player.Name)
	end
	refreshPlayer(player)
	table.insert(
		connections,
		player.CharacterAdded:Connect(function(character)
			onCharacterAdded(player, character)
		end)
	)
	if player.Character ~= nil then
		task.spawn(onCharacterAdded, player, player.Character)
	end
end

local function onPlayerRemoving(player: Player)
	dropCarry(player)
	welcomed[player] = nil
	local plot = StealEggGame.plotOf(player)
	if plot ~= nil then
		StealEggGame.releasePlot(plot)
	end
end

function StealEggGame.start()
	if started then
		return
	end
	started = true
	buildWorld()
	getJuice()

	local toastEvent = Instance.new("RemoteEvent")
	toastEvent.Name = Config.remoteToastName
	toastEvent.Parent = ReplicatedStorage
	toastRemote = toastEvent
	local rebirthEvent = Instance.new("RemoteEvent")
	rebirthEvent.Name = Config.remoteRebirthName
	rebirthEvent.Parent = ReplicatedStorage
	rebirthRemote = rebirthEvent
	table.insert(
		connections,
		rebirthEvent.OnServerEvent:Connect(function(player)
			local ok, reason = StealEggGame.rebirth(player)
			if not ok then
				toast(player, reason)
			end
		end)
	)

	table.insert(connections, Players.PlayerAdded:Connect(onPlayerAdded))
	table.insert(connections, Players.PlayerRemoving:Connect(onPlayerRemoving))
	for _, player in Players:GetPlayers() do
		task.spawn(onPlayerAdded, player)
	end
	table.insert(
		connections,
		RunService.Heartbeat:Connect(function(deltaTime)
			StealEggGame.tick(deltaTime)
		end)
	)
end

-- Removes the world, the remotes, the lighting effects and every connection.
function StealEggGame.destroy()
	for _, connection in connections do
		connection:Disconnect()
	end
	connections = {}
	for player in carrying do
		releaseCarry(player)
	end
	for _, object in lightingObjects do
		object:Destroy()
	end
	lightingObjects = {}
	if toastRemote ~= nil then
		toastRemote:Destroy()
		toastRemote = nil
	end
	if rebirthRemote ~= nil then
		rebirthRemote:Destroy()
		rebirthRemote = nil
	end
	if folder ~= nil then
		folder:Destroy()
		folder = nil
	end
	shotsFolder = nil
	plots = {}
	conveyorEggs = {}
	stripes = {}
	started = false
end

return StealEggGame
