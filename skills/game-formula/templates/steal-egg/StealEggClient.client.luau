--!strict
-- HUD for the Steal an Egg template. Put this LocalScript in StarterPlayerScripts.
-- It shows Cash, income per second, a rebirth button with a progress bar and toasts such as "Your egg was stolen!".
-- Server attributes on the player drive it: IncomePerSecond, Pending, RebirthCost; Cash and Rebirths are leaderstats.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local TOAST_SECONDS = 3
local MAX_TOASTS = 4
local CASH_LABEL_NAME = "CashLabel" -- the name that Juice.pulse(player, "CashLabel") targets
local TOAST_REMOTE = "StealEggToast"
local REBIRTH_REMOTE = "StealEggRebirth"
local ACCENT = Color3.fromRGB(255, 220, 60)
local PANEL = Color3.fromRGB(30, 30, 50)

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local leaderstats = player:WaitForChild("leaderstats")
local cash = leaderstats:WaitForChild("Cash") :: NumberValue
local rebirths = leaderstats:WaitForChild("Rebirths") :: NumberValue
local toastRemote = ReplicatedStorage:WaitForChild(TOAST_REMOTE) :: RemoteEvent
local rebirthRemote = ReplicatedStorage:WaitForChild(REBIRTH_REMOTE) :: RemoteEvent

local function formatCash(amount: number): string
	local text = tostring(math.floor(amount + 0.5))
	local formatted = text:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	return (formatted:gsub("^,", ""))
end

local function round(instance: Instance, radius: number)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius)
	corner.Parent = instance
end

local function newText(parent: Instance, name: string, size: UDim2, position: UDim2, color: Color3): TextLabel
	local label = Instance.new("TextLabel")
	label.Name = name
	label.Size = size
	label.Position = position
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = color
	label.TextStrokeTransparency = 0
	label.Parent = parent
	return label
end

local screen = Instance.new("ScreenGui")
screen.Name = "StealEggHud"
screen.ResetOnSpawn = false
screen.Parent = playerGui

local cashPanel = Instance.new("Frame")
cashPanel.Name = "CashPanel"
cashPanel.AnchorPoint = Vector2.new(0.5, 0)
cashPanel.Position = UDim2.fromScale(0.5, 0.02)
cashPanel.Size = UDim2.fromOffset(340, 96)
cashPanel.BackgroundColor3 = PANEL
cashPanel.BackgroundTransparency = 0.15
cashPanel.Parent = screen
round(cashPanel, 20)
local cashStroke = Instance.new("UIStroke")
cashStroke.Color = ACCENT
cashStroke.Thickness = 3
cashStroke.Parent = cashPanel

local cashLabel = newText(cashPanel, CASH_LABEL_NAME, UDim2.new(1, -20, 0, 56), UDim2.fromOffset(10, 4), ACCENT)
local incomeLabel =
	newText(cashPanel, "IncomeLabel", UDim2.new(1, -40, 0, 26), UDim2.fromOffset(20, 62), Color3.fromRGB(120, 255, 150))

local rebirthPanel = Instance.new("Frame")
rebirthPanel.Name = "RebirthPanel"
rebirthPanel.AnchorPoint = Vector2.new(0, 1)
rebirthPanel.Position = UDim2.new(0, 16, 1, -16)
rebirthPanel.Size = UDim2.fromOffset(250, 96)
rebirthPanel.BackgroundColor3 = PANEL
rebirthPanel.BackgroundTransparency = 0.15
rebirthPanel.Parent = screen
round(rebirthPanel, 16)

local rebirthButton = Instance.new("TextButton")
rebirthButton.Name = "RebirthButton"
rebirthButton.Size = UDim2.new(1, -20, 0, 44)
rebirthButton.Position = UDim2.fromOffset(10, 8)
rebirthButton.BackgroundColor3 = Color3.fromRGB(190, 80, 255)
rebirthButton.Font = Enum.Font.FredokaOne
rebirthButton.TextScaled = true
rebirthButton.TextColor3 = Color3.new(1, 1, 1)
rebirthButton.Text = "REBIRTH"
rebirthButton.AutoButtonColor = true
rebirthButton.Parent = rebirthPanel
round(rebirthButton, 12)

local barBack = Instance.new("Frame")
barBack.Name = "ProgressBack"
barBack.Position = UDim2.fromOffset(10, 60)
barBack.Size = UDim2.new(1, -20, 0, 24)
barBack.BackgroundColor3 = Color3.fromRGB(60, 60, 90)
barBack.Parent = rebirthPanel
round(barBack, 12)
local barFill = Instance.new("Frame")
barFill.Name = "ProgressFill"
barFill.Size = UDim2.fromScale(0, 1)
barFill.BackgroundColor3 = Color3.fromRGB(120, 255, 150)
barFill.Parent = barBack
round(barFill, 12)
local barText = newText(barBack, "ProgressText", UDim2.fromScale(1, 1), UDim2.fromScale(0, 0), Color3.new(1, 1, 1))
barText.TextScaled = false
barText.TextSize = 16

local toastList = Instance.new("Frame")
toastList.Name = "Toasts"
toastList.AnchorPoint = Vector2.new(0.5, 0)
toastList.Position = UDim2.fromScale(0.5, 0.2)
toastList.Size = UDim2.fromOffset(420, 200)
toastList.BackgroundTransparency = 1
toastList.Parent = screen
local toastLayout = Instance.new("UIListLayout")
toastLayout.Padding = UDim.new(0, 6)
toastLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
toastLayout.Parent = toastList

local function showToast(message: string)
	if #toastList:GetChildren() > MAX_TOASTS then
		return
	end
	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 0, 40)
	label.BackgroundColor3 = Color3.fromRGB(255, 70, 70)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.new(1, 1, 1)
	label.Text = message
	label.Parent = toastList
	round(label, 12)
	task.delay(TOAST_SECONDS, function()
		local tween =
			TweenService:Create(label, TweenInfo.new(0.4), { BackgroundTransparency = 1, TextTransparency = 1 })
		tween.Completed:Once(function()
			label:Destroy()
		end)
		tween:Play()
	end)
end

local function refresh()
	local income = player:GetAttribute("IncomePerSecond")
	local cost = player:GetAttribute("RebirthCost")
	local incomeNumber = if typeof(income) == "number" then income else 0
	local costNumber = if typeof(cost) == "number" then cost else 1
	cashLabel.Text = "$" .. formatCash(cash.Value)
	incomeLabel.Text = "+$" .. formatCash(incomeNumber) .. " / sec   Rebirths: " .. tostring(rebirths.Value)
	local progress = math.clamp(cash.Value / math.max(costNumber, 1), 0, 1)
	barFill.Size = UDim2.fromScale(progress, 1)
	barText.Text = "$" .. formatCash(cash.Value) .. " / $" .. formatCash(costNumber)
	rebirthButton.Text = if progress >= 1 then "REBIRTH NOW!" else "REBIRTH"
end

cash.Changed:Connect(refresh)
rebirths.Changed:Connect(refresh)
player:GetAttributeChangedSignal("IncomePerSecond"):Connect(refresh)
player:GetAttributeChangedSignal("RebirthCost"):Connect(refresh)
rebirthButton.Activated:Connect(function()
	rebirthRemote:FireServer()
end)
toastRemote.OnClientEvent:Connect(function(message: string)
	showToast(message)
end)
refresh()
