--!strict
-- Server bootstrap. Put this Script in ServerScriptService next to PlayerData, GamePasses and Receipts.
-- Each start() must run once, from this one script.
local PlayerData = require(script.Parent.PlayerData)
local GamePasses = require(script.Parent.GamePasses)
local Receipts = require(script.Parent.Receipts)

PlayerData.start()
GamePasses.start()
Receipts.start()
