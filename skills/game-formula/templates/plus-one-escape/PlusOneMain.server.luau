--!strict
-- Server bootstrap. Put this Script in ServerScriptService next to the PlusOneGame ModuleScript.
-- GameFormulaJuice (ReplicatedStorage) and GameFormulaFxClient (StarterPlayerScripts) must be inserted first.
local PlusOneGame = require(script.Parent.PlusOneGame)

PlusOneGame.start()
