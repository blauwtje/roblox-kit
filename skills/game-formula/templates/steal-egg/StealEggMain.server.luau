--!strict
-- Server bootstrap. Put this Script in ServerScriptService next to StealEggGame, with the GameFormulaJuice
-- ModuleScript in ReplicatedStorage. It builds the world under Workspace.GameFormulaStealEgg and runs the loop.
-- Tunables (prices, rarities, rates) are in the Config table at the top of StealEggGame.
local StealEggGame = require(script.Parent.StealEggGame)

StealEggGame.start()
