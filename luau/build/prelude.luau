--!strict
-- Helpers every file in luau/build/ shares; build_map sends it inside the file of the running phase
-- (each file reads `local buildPrelude = require("./prelude")`, which the bundler inlines) and
-- calls it with its own arguments. `run` wraps the phase in one undo recording and encodes the result.
type Vector = { x: number, y: number, z: number }

type HeroLoadFailure = { kind: string, assetId: string, error: string }

type PreludeArguments = {
	phase: string,
	mapId: string,
	mapsFolderName: string,
}

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local HttpService = game:GetService("HttpService")

local function toVector3(vector: Vector): Vector3
	return Vector3.new(vector.x, vector.y, vector.z)
end

local function materialNamed(materialName: string): Enum.Material
	return (Enum.Material:FromName(materialName) :: any) :: Enum.Material
end

local function countPartChildren(model: Model): number
	local count = 0
	for _, child in model:GetChildren() do
		if child:IsA("BasePart") then
			count += 1
		end
	end
	return count
end

return function(arguments: PreludeArguments)
	local function findModel(): Model
		local folder = workspace:FindFirstChild(arguments.mapsFolderName)
		local model = if folder then folder:FindFirstChild(arguments.mapId) else nil
		if not model or not model:IsA("Model") then
			error(
				`Map "{arguments.mapId}" is not under Workspace.{arguments.mapsFolderName}; the shell phase builds it first.`,
				0
			)
		end
		return model
	end

	-- Runs the phase body, which returns whether the shell replaced a map (nil for later phases), the Model's part
	-- count and the hero assets the props phase failed to load; returns the JSON build_map parses.
	local function run(body: () -> (boolean?, number, { HeroLoadFailure }?)): string
		-- Under execute_luau ChangeHistoryService is disabled and this is nil (research: TryBeginRecording returns nil), so the
		-- build runs unrecorded; the recording is kept for a Studio that allows it.
		local recordingStarted, recordingId = pcall(function()
			return ChangeHistoryService:TryBeginRecording(
				"roblox-kit build_map",
				`Build map {arguments.mapId}: {arguments.phase}`
			)
		end)
		local recording: string? = if recordingStarted and typeof(recordingId) == "string" then recordingId else nil

		local built, replacedOrError, partCount, heroLoadFailures = pcall(body)
		if recording then
			local operation = if built
				then Enum.FinishRecordingOperation.Commit
				else Enum.FinishRecordingOperation.Cancel
			ChangeHistoryService:FinishRecording(recording, operation)
		end
		if not built then
			local undoNote = if recording
				then "The phase was cancelled and undone."
				else "No undo recording was open, so nothing was undone."
			error(
				`Building map "{arguments.mapId}" failed in the "{arguments.phase}" phase: {tostring(replacedOrError)}. {undoNote}`,
				0
			)
		end

		return HttpService:JSONEncode({
			partCount = partCount,
			replaced = replacedOrError,
			heroLoadFailures = heroLoadFailures,
		})
	end

	return {
		toVector3 = toVector3,
		materialNamed = materialNamed,
		countPartChildren = countPartChildren,
		findModel = findModel,
		run = run,
	}
end
