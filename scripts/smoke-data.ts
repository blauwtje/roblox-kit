import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../src/config.ts";
import { selectStudio, type StudioConnection } from "../src/studio/studio-connection.ts";
import { createRunInPlaytestTool } from "../src/playtest/run-in-playtest-tool.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";
import { profileStorePath } from "./profilestore-cache.ts";
import {
  createInstance,
  executeLuau,
  insertScript,
  removeMarked,
  runSmokePlaytest,
  textOf,
} from "./studio-insert.ts";

/**
 * End-to-end check of the `data` skill templates in the open place: inserts ProfileStore and the templates
 * under ServerScriptService, runs the DataChecks body in a solo `play` playtest and removes everything it
 * inserted, even after a failure. Inside Studio the templates use ProfileStore's in-memory mock store.
 */
const templateFolder = new URL("../skills/data/templates/", import.meta.url);
const markerAttribute = "RobloxKitDataSmoke";
const packagesFolderName = "ServerPackages";
const playtestTimeoutSeconds = 90;
const profileWaitSeconds = 30;
const serverScriptService = `game:GetService("ServerScriptService")`;

interface Template {
  name: string;
  className: "ModuleScript" | "Script";
  file: string;
}
const templates: Template[] = [
  { name: "PlayerData", className: "ModuleScript", file: "PlayerData.luau" },
  { name: "GamePasses", className: "ModuleScript", file: "GamePasses.luau" },
  { name: "Receipts", className: "ModuleScript", file: "Receipts.luau" },
  { name: "DataChecks", className: "ModuleScript", file: "DataChecks.luau" },
  { name: "Main", className: "Script", file: "Main.server.luau" },
];

const dataChecksBody = `require(game:GetService("ServerScriptService"):WaitForChild("DataChecks"))(check, expectedClients)`;

/** Waits for the local player's profile in the live server and returns its data. */
const liveProfileCode = `
local Players = game:GetService("Players")
local PlayerData = require(game:GetService("ServerScriptService"):WaitForChild("PlayerData"))
local deadline = os.clock() + ${String(profileWaitSeconds)}
while os.clock() < deadline do
	for _, player in Players:GetPlayers() do
		local profile = PlayerData.get(player)
		if profile ~= nil then
			return { player = player.Name, data = profile.Data }
		end
	end
	task.wait(0.25)
end
error("No player profile loaded")`;

/** Fails when the run_in_playtest probe Script is still in the playtest server. */
const probeLeftoverLuau = `
return tostring(game:GetService("ServerScriptService"):FindFirstChild("RobloxKitPlaytestProbe") ~= nil)`;

async function setPlay(
  connection: StudioConnection,
  studioId: string,
  isStart: boolean,
): Promise<void> {
  const result = await connection.callTool({
    name: "start_stop_play",
    studioId,
    arguments: { is_start: isStart },
  });
  if (result.isError === true) throw new Error(`start_stop_play failed: ${textOf(result)}`);
}

/** Reads the live PlayerData profile through run_in_playtest, then stops the playtest even after a failure. */
async function readLiveProfile(connection: StudioConnection, studioId: string): Promise<string> {
  await setPlay(connection, studioId, true);
  try {
    const tool = createRunInPlaytestTool();
    const input = tool.inputSchema.parse({
      code: liveProfileCode,
      timeoutSeconds: profileWaitSeconds + 10,
      studioId,
    });
    const result = await tool.handler(input, { studio: connection });
    if (result.isError === true) throw new Error(`run_in_playtest failed: ${textOf(result)}`);
    const { value } = tool.outputSchema.parse(result.structuredContent);
    const profile = z
      .object({ player: z.string(), data: z.object({ DataVersion: z.number() }).loose() })
      .parse(value);
    const leftover = await connection.callTool({
      name: "execute_luau",
      studioId,
      arguments: { code: probeLeftoverLuau, datamodel_type: "Server" },
    });
    if (textOf(leftover) !== "false") throw new Error("The run_in_playtest probe Script remains");
    return `read ${profile.player}'s live profile at DataVersion ${String(profile.data.DataVersion)}`;
  } finally {
    await setPlay(connection, studioId, false);
  }
}

/** Fails before inserting anything when the place already has an instance the smoke would shadow. */
const preflightLuau = `
local ServerScriptService = game:GetService("ServerScriptService")
local taken = {}
for _, name in {${[packagesFolderName, ...templates.map((template) => template.name)].map((name) => `"${name}"`).join(", ")}} do
	if ServerScriptService:FindFirstChild(name) ~= nil then
		table.insert(taken, name)
	end
end
return table.concat(taken, ", ")`;

async function runSmoke(connection: StudioConnection, studioId: string): Promise<string> {
  const taken = await executeLuau(connection, studioId, preflightLuau);
  if (taken !== "")
    throw new Error(`ServerScriptService already holds ${taken}; remove it and rerun`);

  await createInstance(
    connection,
    studioId,
    markerAttribute,
    serverScriptService,
    packagesFolderName,
    "Folder",
  );
  await insertScript(
    connection,
    studioId,
    markerAttribute,
    `${serverScriptService}:FindFirstChild("${packagesFolderName}")`,
    "ProfileStore",
    "ModuleScript",
    await readFile(await profileStorePath(), "utf8"),
  );
  for (const template of templates) {
    await insertScript(
      connection,
      studioId,
      markerAttribute,
      serverScriptService,
      template.name,
      template.className,
      await readFile(new URL(template.file, templateFolder), "utf8"),
    );
  }

  console.log(await readLiveProfile(connection, studioId));
  return await runSmokePlaytest(connection, studioId, "data", {
    serverChecks: dataChecksBody,
    timeoutSeconds: playtestTimeoutSeconds,
  });
}

const connection = new StudioMcpClient({
  clientInfo: { name: `${config.serverName}-smoke-data`, version: config.serverVersion },
  timeoutMs: config.upstreamTimeoutMs,
});
try {
  const studioId = await selectStudio(connection, undefined);
  try {
    console.log(await runSmoke(connection, studioId));
  } finally {
    const removed = await removeMarked(
      connection,
      studioId,
      "ServerScriptService",
      markerAttribute,
    );
    console.log(`removed ${removed} inserted instances`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
}
