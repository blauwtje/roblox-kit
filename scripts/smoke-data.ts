import { readFile } from "node:fs/promises";
import { config } from "../src/config.ts";
import { selectStudio, type StudioConnection } from "../src/studio/studio-connection.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";
import { profileStorePath } from "./profilestore-cache.ts";
import {
  createInstance,
  executeLuau,
  insertScript,
  removeMarked,
  runSmokePlaytest,
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
