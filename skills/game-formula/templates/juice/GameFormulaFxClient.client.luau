--!strict
-- Draws the effects the server asks for through GameFormulaJuice. Put this LocalScript in StarterPlayerScripts.
-- Every effect is local to this client and cleans up after itself with Debris or by destroying its tween.

local CollectionService = game:GetService("CollectionService")
local Debris = game:GetService("Debris")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local REMOTE_NAME = "GameFormulaFx"
local SPIN_TAG = "GameFormulaSpin"
local BOB_TAG = "GameFormulaBob"
local POP_RISE_STUDS = 5
local POP_SECONDS = 1.1
local BURST_LIFETIME = 1.2
local CUTSCENE_RETURN_SECONDS = 0.4
local PULSE_SCALE = 1.3

local localPlayer = Players.LocalPlayer
local playerGui = localPlayer:WaitForChild("PlayerGui") :: PlayerGui

local function colorOrDefault(value: unknown): Color3
	if typeof(value) == "Color3" then
		return value
	end
	return Color3.fromRGB(255, 221, 64)
end

local function anchorPart(position: Vector3, lifetime: number): Part
	local anchor = Instance.new("Part")
	anchor.Name = "GameFormulaFxAnchor"
	anchor.Anchored = true
	anchor.CanCollide = false
	anchor.CanQuery = false
	anchor.CanTouch = false
	anchor.Transparency = 1
	anchor.Size = Vector3.new(0.2, 0.2, 0.2)
	anchor.Position = position
	anchor.Parent = Workspace
	Debris:AddItem(anchor, lifetime)
	return anchor
end

local function popText(position: Vector3, text: string, color: Color3)
	local anchor = anchorPart(position, POP_SECONDS + 0.2)

	local billboard = Instance.new("BillboardGui")
	billboard.Size = UDim2.fromOffset(200, 60)
	billboard.AlwaysOnTop = true
	billboard.LightInfluence = 0
	billboard.Adornee = anchor
	billboard.Parent = anchor

	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.AnchorPoint = Vector2.new(0.5, 0.5)
	label.Position = UDim2.fromScale(0.5, 0.5)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.Text = text
	label.TextScaled = true
	label.TextColor3 = color
	label.Parent = billboard

	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 3
	stroke.Color = Color3.fromRGB(30, 20, 10)
	stroke.Parent = label

	local scale = Instance.new("UIScale")
	scale.Scale = 0.3
	scale.Parent = label

	TweenService:Create(scale, TweenInfo.new(0.18, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1.15 })
		:Play()
	TweenService:Create(
		anchor,
		TweenInfo.new(POP_SECONDS, Enum.EasingStyle.Quad, Enum.EasingDirection.Out),
		{ Position = position + Vector3.new(0, POP_RISE_STUDS, 0) }
	):Play()
	local fadeInfo =
		TweenInfo.new(POP_SECONDS * 0.45, Enum.EasingStyle.Quad, Enum.EasingDirection.In, 0, false, POP_SECONDS * 0.55)
	TweenService:Create(label, fadeInfo, { TextTransparency = 1 }):Play()
	TweenService:Create(stroke, fadeInfo, { Transparency = 1 }):Play()
end

local function burst(position: Vector3, color: Color3, count: number)
	local anchor = anchorPart(position, BURST_LIFETIME + 1)
	local emitter = Instance.new("ParticleEmitter")
	emitter.Enabled = false
	emitter.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	emitter.Color = ColorSequence.new(color, Color3.new(1, 1, 1))
	emitter.LightEmission = 0.8
	emitter.Lifetime = NumberRange.new(0.5, BURST_LIFETIME)
	emitter.Speed = NumberRange.new(10, 22)
	emitter.SpreadAngle = Vector2.new(180, 180)
	emitter.Drag = 4
	emitter.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 1.2),
		NumberSequenceKeypoint.new(1, 0),
	})
	emitter.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0),
		NumberSequenceKeypoint.new(0.7, 0.2),
		NumberSequenceKeypoint.new(1, 1),
	})
	emitter.Parent = anchor
	emitter:Emit(count)
end

local function fade(seconds: number)
	local gui = Instance.new("ScreenGui")
	gui.Name = "GameFormulaFade"
	gui.IgnoreGuiInset = true
	gui.DisplayOrder = 100
	gui.ResetOnSpawn = false
	gui.Parent = playerGui

	local cover = Instance.new("Frame")
	cover.Size = UDim2.fromScale(1, 1)
	cover.BackgroundColor3 = Color3.new(0, 0, 0)
	cover.BackgroundTransparency = 1
	cover.BorderSizePixel = 0
	cover.Parent = gui

	local info = TweenInfo.new(seconds / 2, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut)
	local fadeOut = TweenService:Create(cover, info, { BackgroundTransparency = 0 })
	local fadeIn = TweenService:Create(cover, info, { BackgroundTransparency = 1 })
	fadeOut.Completed:Once(function()
		fadeIn:Play()
	end)
	fadeIn.Completed:Once(function()
		gui:Destroy()
	end)
	fadeOut:Play()
	Debris:AddItem(gui, seconds + 2)
end

local cutsceneId = 0

local function cutscene(points: { CFrame }, seconds: number)
	local camera = Workspace.CurrentCamera
	if not camera then
		return
	end
	cutsceneId += 1
	local myId = cutsceneId
	local startCFrame = camera.CFrame
	local previousType = camera.CameraType
	camera.CameraType = Enum.CameraType.Scriptable

	local driver = Instance.new("CFrameValue")
	driver.Value = startCFrame
	driver.Changed:Connect(function(value: CFrame)
		if myId == cutsceneId then
			camera.CFrame = value
		end
	end)

	local segmentSeconds = seconds / #points
	task.spawn(function()
		for _, target in points do
			if myId ~= cutsceneId then
				break
			end
			local tween = TweenService:Create(
				driver,
				TweenInfo.new(segmentSeconds, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut),
				{ Value = target }
			)
			tween:Play()
			tween.Completed:Wait()
		end
		if myId == cutsceneId then
			local back = TweenService:Create(
				driver,
				TweenInfo.new(CUTSCENE_RETURN_SECONDS, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut),
				{ Value = startCFrame }
			)
			back:Play()
			back.Completed:Wait()
			camera.CameraType = if previousType == Enum.CameraType.Scriptable
				then Enum.CameraType.Custom
				else previousType
			local character = localPlayer.Character
			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			if humanoid then
				camera.CameraSubject = humanoid
			end
		end
		driver:Destroy()
	end)
end

local function pulse(labelName: string)
	for _, descendant in playerGui:GetDescendants() do
		if descendant.Name == labelName and (descendant:IsA("TextLabel") or descendant:IsA("TextButton")) then
			local scale = descendant:FindFirstChildOfClass("UIScale") or Instance.new("UIScale")
			scale.Parent = descendant
			scale.Scale = 1
			local up = TweenService:Create(
				scale,
				TweenInfo.new(0.12, Enum.EasingStyle.Back, Enum.EasingDirection.Out),
				{ Scale = PULSE_SCALE }
			)
			local down = TweenService:Create(
				scale,
				TweenInfo.new(0.2, Enum.EasingStyle.Quad, Enum.EasingDirection.Out),
				{ Scale = 1 }
			)
			up.Completed:Once(function()
				down:Play()
			end)
			up:Play()
		end
	end
end

-- Looping motion for tagged parts. Each part gets a NumberValue tweened forever; its Changed event sets the
-- part's local CFrame from the CFrame it had when the tag arrived.
local motion: { [BasePart]: { values: { NumberValue }, tweens: { Tween } } } = {}

local function stopMotion(part: BasePart)
	local state = motion[part]
	if not state then
		return
	end
	motion[part] = nil
	for _, tween in state.tweens do
		tween:Cancel()
		tween:Destroy()
	end
	for _, value in state.values do
		value:Destroy()
	end
end

local function startMotion(part: BasePart)
	stopMotion(part)
	local baseCFrame = part.CFrame
	local angle = 0
	local lift = 0
	local state = { values = {}, tweens = {} } :: { values: { NumberValue }, tweens: { Tween } }
	motion[part] = state

	local function apply()
		part.CFrame = baseCFrame * CFrame.Angles(0, math.rad(angle), 0) + Vector3.new(0, lift, 0)
	end

	if CollectionService:HasTag(part, SPIN_TAG) then
		local seconds = part:GetAttribute("GameFormulaSpinSeconds")
		local value = Instance.new("NumberValue")
		table.insert(state.values, value)
		value.Changed:Connect(function(newAngle: number)
			angle = newAngle
			apply()
		end)
		local tween = TweenService:Create(
			value,
			TweenInfo.new(
				if type(seconds) == "number" then seconds else 4,
				Enum.EasingStyle.Linear,
				Enum.EasingDirection.In,
				-1
			),
			{ Value = 360 }
		)
		table.insert(state.tweens, tween)
		tween:Play()
	end
	if CollectionService:HasTag(part, BOB_TAG) then
		local height = part:GetAttribute("GameFormulaBobHeight")
		local value = Instance.new("NumberValue")
		table.insert(state.values, value)
		value.Changed:Connect(function(newLift: number)
			lift = newLift
			apply()
		end)
		local tween = TweenService:Create(
			value,
			TweenInfo.new(1.1, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true),
			{ Value = if type(height) == "number" then height else 1 }
		)
		table.insert(state.tweens, tween)
		tween:Play()
	end
end

for _, tag in { SPIN_TAG, BOB_TAG } do
	CollectionService:GetInstanceAddedSignal(tag):Connect(function(instance: Instance)
		if instance:IsA("BasePart") then
			startMotion(instance)
		end
	end)
	CollectionService:GetInstanceRemovedSignal(tag):Connect(function(instance: Instance)
		if
			instance:IsA("BasePart")
			and not CollectionService:HasTag(instance, SPIN_TAG)
			and not CollectionService:HasTag(instance, BOB_TAG)
		then
			stopMotion(instance)
		end
	end)
	for _, instance in CollectionService:GetTagged(tag) do
		if instance:IsA("BasePart") then
			startMotion(instance)
		end
	end
end

local remote = ReplicatedStorage:WaitForChild(REMOTE_NAME) :: RemoteEvent

remote.OnClientEvent:Connect(function(kind: unknown, a: unknown, b: unknown, c: unknown)
	if kind == "pop" and typeof(a) == "Vector3" and type(b) == "string" then
		popText(a, b, colorOrDefault(c))
	elseif kind == "burst" and typeof(a) == "Vector3" and type(c) == "number" then
		burst(a, colorOrDefault(b), c)
	elseif kind == "fade" and type(a) == "number" then
		fade(a)
	elseif kind == "cutscene" and type(a) == "table" and type(b) == "number" then
		local points: { CFrame } = {}
		for _, item in a :: { unknown } do
			if typeof(item) == "CFrame" then
				table.insert(points, item)
			end
		end
		if #points > 0 then
			cutscene(points, b)
		end
	elseif kind == "pulse" and type(a) == "string" then
		pulse(a)
	end
end)
