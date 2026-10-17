--!strict
-- findMapModel returns nil when the map is missing; callers word their own error.
return {
	findMapModel = function(folderName: string, mapId: string): Model?
		local folder = workspace:FindFirstChild(folderName)
		local model = folder and folder:FindFirstChild(mapId)
		return if model and model:IsA("Model") then model else nil
	end,
	toVector3 = function(v: { x: number, y: number, z: number }): Vector3
		return Vector3.new(v.x, v.y, v.z)
	end,
}
