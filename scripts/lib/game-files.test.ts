import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyGameFile } from "./game-files.ts";

await test("client, server, shared and plain module files get their class and parent", () => {
  assert.deepEqual(classifyGameFile("GameFormulaFxClient.client.luau"), {
    name: "GameFormulaFxClient",
    className: "LocalScript",
    parent: `game:GetService("StarterPlayer"):FindFirstChild("StarterPlayerScripts")`,
    container: "StarterPlayerScripts",
  });
  assert.deepEqual(
    [classifyGameFile("Main.server.luau")].map((entry) => [entry?.className, entry?.container]),
    [["Script", "ServerScriptService"]],
  );
  assert.equal(classifyGameFile("GameFormulaJuice.luau")?.container, "ReplicatedStorage");
  assert.deepEqual(
    [classifyGameFile("Eggs.luau")].map((entry) => [entry?.className, entry?.container]),
    [["ModuleScript", "ServerScriptService"]],
  );
});

await test("Checks.luau is not inserted and non-luau files are rejected", () => {
  assert.equal(classifyGameFile("Checks.luau"), undefined);
  assert.throws(() => classifyGameFile("README.md"), /not a .luau/);
  assert.throws(() => classifyGameFile(".client.luau"), /needs a name/);
});
