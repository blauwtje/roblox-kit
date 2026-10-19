--!strict
-- Client HUD. Put this LocalScript in StarterPlayerScripts. It reads leaderstats and the player attributes the
-- PlusOneGame module sets, and fires the PlusOneRebirth RemoteEvent in ReplicatedStorage from the rebirth button.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local CONFIG = {
	strengthLabelName = "StrengthLabel", -- the label GameFormulaJuice.pulse is asked to pulse
	rebirthRemoteName = "PlusOneRebirth",
	barTweenSeconds = 0.25,
	accent = Color3.fromRGB(255, 220, 60),
	panel = Color3.fromRGB(25, 25, 45),
	rebirthColor = Color3.fromRGB(255, 120, 200),
}

local player = Players.LocalPlayer
local leaderstats = player:WaitForChild("leaderstats")
local rebirthRemote = ReplicatedStorage:WaitForChild(CONFIG.rebirthRemoteName) :: RemoteEvent

local function styled<T>(instance: T & Instance, parent: Instance): T
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 12)
	corner.Parent = instance
	instance.Parent = parent
	return instance
end

local function newLabel(parent: Instance, name: string, size: UDim2, position: UDim2, textSize: number): TextLabel
	local label = Instance.new("TextLabel")
	label.Name = name
	label.Size = size
	label.Position = position
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBlack
	label.TextSize = textSize
	label.TextColor3 = Color3.new(1, 1, 1)
	label.Parent = parent
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 3
	stroke.Color = Color3.fromRGB(20, 20, 30)
	stroke.Parent = label
	return label
end

local gui = Instance.new("ScreenGui")
gui.Name = "PlusOneHud"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.Parent = player:WaitForChild("PlayerGui")

local strengthLabel =
	newLabel(gui, CONFIG.strengthLabelName, UDim2.fromOffset(360, 64), UDim2.new(0.5, -180, 0, 16), 52)
strengthLabel.TextColor3 = CONFIG.accent

local barBack = Instance.new("Frame")
barBack.Name = "ProgressBack"
barBack.Size = UDim2.fromOffset(360, 30)
barBack.Position = UDim2.new(0.5, -180, 0, 86)
barBack.BackgroundColor3 = CONFIG.panel
barBack.BorderSizePixel = 0
styled(barBack, gui)

local barFill = Instance.new("Frame")
barFill.Name = "Fill"
barFill.Size = UDim2.fromScale(0, 1)
barFill.BackgroundColor3 = CONFIG.accent
barFill.BorderSizePixel = 0
styled(barFill, barBack)

local barLabel = newLabel(barBack, "NextLabel", UDim2.fromScale(1, 1), UDim2.fromScale(0, 0), 20)

local statsLabel = newLabel(gui, "StatsLabel", UDim2.fromOffset(300, 60), UDim2.new(0, 16, 1, -76), 24)
statsLabel.TextXAlignment = Enum.TextXAlignment.Left

local rebirthButton = Instance.new("TextButton")
rebirthButton.Name = "RebirthButton"
rebirthButton.Size = UDim2.fromOffset(220, 56)
rebirthButton.Position = UDim2.new(1, -236, 1, -72)
rebirthButton.BackgroundColor3 = CONFIG.rebirthColor
rebirthButton.BorderSizePixel = 0
rebirthButton.Font = Enum.Font.GothamBlack
rebirthButton.TextSize = 22
rebirthButton.TextColor3 = Color3.new(1, 1, 1)
styled(rebirthButton, gui)
rebirthButton.Activated:Connect(function()
	rebirthRemote:FireServer()
end)

local function stat(name: string): number
	local value = leaderstats:FindFirstChild(name)
	if value ~= nil and value:IsA("IntValue") then
		return value.Value
	end
	return 0
end

local function refresh()
	local strength = stat("Strength")
	local nextGate = player:GetAttribute("NextGate")
	local previousGate = player:GetAttribute("PreviousGate")
	local requiredWins = player:GetAttribute("RebirthWins")
	local multiplier = player:GetAttribute("Multiplier")
	strengthLabel.Text = `Strength {strength}`
	local ratio = 1
	if typeof(nextGate) == "number" and nextGate > 0 then
		local floor = if typeof(previousGate) == "number" then previousGate else 0
		ratio = math.clamp((strength - floor) / math.max(1, nextGate - floor), 0, 1)
		barLabel.Text = `Next: {nextGate}`
	else
		barLabel.Text = "Reach the finish!"
	end
	TweenService:Create(barFill, TweenInfo.new(CONFIG.barTweenSeconds), { Size = UDim2.fromScale(ratio, 1) }):Play()
	statsLabel.Text = `Wins {stat("Wins")}   Rebirths {stat("Rebirths")}   x{if typeof(multiplier) == "number"
		then multiplier
		else 1}`
	rebirthButton.Text = if typeof(requiredWins) == "number" then `Rebirth ({requiredWins} Wins)` else "Rebirth"
	rebirthButton.AutoButtonColor = typeof(requiredWins) == "number" and stat("Wins") >= requiredWins
end

for _, child in leaderstats:GetChildren() do
	if child:IsA("IntValue") then
		child:GetPropertyChangedSignal("Value"):Connect(refresh)
	end
end
for _, attribute in { "NextGate", "PreviousGate", "RebirthWins", "Multiplier" } do
	player:GetAttributeChangedSignal(attribute):Connect(refresh)
end
refresh()
