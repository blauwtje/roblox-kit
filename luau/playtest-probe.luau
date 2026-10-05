--!strict
-- Probe Script of roblox-kit's run_in_playtest. The tool inserts it into ServerScriptService of a running
-- playtest with the caller's code as the body of `probe`, so `require` returns the live module instances.
-- The result lands as a JSON attribute on this Script: `{ ok = true, value = any }` or `{ ok = false, error = string }`.
local HttpService = game:GetService("HttpService")

-- Must equal the name in run-in-playtest.luau.
local RESULT_ATTRIBUTE = "RobloxKitProbeResult"
-- Studio caps a string attribute at 65,535 bytes; the result stays below it.
local MAX_RESULT_BYTES = 60000

local function probe(): ...any
	-- roblox-kit:check-body
end

local function encodeOutcome(): string
	local succeeded, value = pcall(probe)
	if not succeeded then
		return HttpService:JSONEncode({ ok = false, error = tostring(value) })
	end
	local encoded, json = pcall(HttpService.JSONEncode, HttpService, { ok = true, value = value })
	if not encoded then
		return HttpService:JSONEncode({ ok = false, error = `The returned value is not JSON-encodable: {json}` })
	end
	if #json > MAX_RESULT_BYTES then
		return HttpService:JSONEncode({
			ok = false,
			error = `The returned value is {#json} bytes of JSON, over {MAX_RESULT_BYTES}.`,
		})
	end
	return json
end

script:SetAttribute(RESULT_ATTRIBUTE, encodeOutcome())
