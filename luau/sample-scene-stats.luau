--!strict
-- Samples the scene's draw calls and triangles from each zone camera, for check_map.
-- Returns one short sample per shot, so execute_luau does not cut it.
type Shot = {
	zone: string,
	cameraPosition: { number },
	lookAt: { number },
}

type Arguments = {
	shots: { Shot },
	statsSettleSeconds: number,
}

type Sample = {
	zone: string,
	drawCalls: number,
	triangles: number,
}

local arguments: Arguments = ...
local HttpService = game:GetService("HttpService")
local Stats = game:GetService("Stats")

local camera: Camera? = workspace.CurrentCamera
if camera == nil then
	error(
		"Workspace has no CurrentCamera, so no zone camera can be placed. Open a Studio viewport on the place, then retry.",
		0
	)
end

local function vectorOf(coordinates: { number }): Vector3
	return Vector3.new(coordinates[1], coordinates[2], coordinates[3])
end

local originalCFrame = camera.CFrame

local samples: { Sample } = {}
local sampled, failure = pcall(function()
	for _, shot in arguments.shots do
		camera.CFrame = CFrame.lookAt(vectorOf(shot.cameraPosition), vectorOf(shot.lookAt))
		-- A shorter wait reads the numbers of the previous camera.
		task.wait(arguments.statsSettleSeconds)
		table.insert(samples, {
			zone = shot.zone,
			drawCalls = Stats.SceneDrawcallCount,
			triangles = Stats.SceneTriangleCount,
		})
	end
end)

camera.CFrame = originalCFrame
if not sampled then
	error(`Sampling the scene stats failed: {failure}`, 0)
end
return HttpService:JSONEncode({ samples = samples })
