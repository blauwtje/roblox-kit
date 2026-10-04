--!strict
-- Server bootstrap. Put this Script in ServerScriptService next to the modules it requires, with the generated
-- Blink server file at ServerScriptService.Network.
--
-- Connect every `From: Client` listener here, once, at server start (Roblox's client-server-boundary guidance).
-- Blink 0.18.9 queues events that have no listener without a limit and only warns past 256, so a client could
-- otherwise grow that queue before a listener exists. Connect each event once: a second `On` replaces the first.

local ServerScriptService = game:GetService("ServerScriptService")

local Network = require(ServerScriptService.Network)
local Pickups = require(script.Parent.Pickups)
local RateLimit = require(script.Parent.RateLimit)
local Rejections = require(script.Parent.Rejections)

Rejections.start()
RateLimit.start()
Pickups.start()

-- One limit per `From: Client` event in network/game.blink; consume throws for an event with no limit.
RateLimit.configure({
	RequestPickup = { capacity = 5, refillPerSecond = 2 },
	DropItem = { capacity = 5, refillPerSecond = 2 },
	GetInventory = { capacity = 5, refillPerSecond = 1 },
})

Network.RequestPickup.On(Pickups.requestPickup)
Network.DropItem.On(Pickups.dropItem)
Network.GetInventory.On(Pickups.getInventory)
