--!strict
-- Smoke file for runLuauFile: answers with the message it was given.
local arguments: { message: string } = ...
local HttpService = game:GetService("HttpService")

return HttpService:JSONEncode({ pong = true, echo = arguments.message })
