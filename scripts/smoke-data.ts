import { readFile } from "node:fs/promises";
import { config } from "../src/config.ts";
import { createRunPlaytestTool } from "../src/playtest/run-playtest-tool.ts";
import { selectStudio, type StudioConnection } from "../src/studio/studio-connection.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";
import { profileStorePath } from "./profilestore-cache.ts";

/**
 * End-to-end check of the `data` skill templates in the open place: inserts ProfileStore and the templates
 * under ServerScriptService, runs the DataChecks body in a solo `play` playtest and removes everything it
 * inserted, even after a failure. Inside Studio the templates use ProfileStore's in-memory mock store.
 */
const templateFolder = new URL("../skills/data/templates/", import.meta.url);
const markerAttribute = "RobloxKitDataSmoke";
const packagesFolderName = "ServerPackages";
const playtestTimeoutSeconds = 90;
/** Characters of source per `execute_luau` call, well under any request limit. */
const sourceChunkLength = 40_000;

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

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

async function executeLuau(
  connection: StudioConnection,
  studioId: string,
  code: string,
): Promise<string> {
  const result = await connection.callTool({
    name: "execute_luau",
    studioId,
    arguments: { code, datamodel_type: "Edit" },
  });
  if (result.isError === true) throw new Error(`execute_luau failed: ${textOf(result)}`);
  return textOf(result);
}

/** A Luau long string that holds `text` verbatim: more `=` than any closing bracket inside it. */
function longString(text: string): string {
  let level = 0;
  while (text.includes(`]${"=".repeat(level)}]`)) level += 1;
  const equals = "=".repeat(level);
  // The first newline after the opening bracket is dropped by Luau, so this one is not part of the text.
  return `[${equals}[\n${text}]${equals}]`;
}

const cleanupLuau = `
local ServerScriptService = game:GetService("ServerScriptService")
local removed = 0
for _, child in ServerScriptService:GetChildren() do
	if child:GetAttribute("${markerAttribute}") == true then
		child:Destroy()
		removed += 1
	end
end
return tostring(removed)`;

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

function createLuau(parentPath: string, name: string, className: string): string {
  return `
local ServerScriptService = game:GetService("ServerScriptService")
local parent = ${parentPath}
local instance = Instance.new("${className}")
instance.Name = "${name}"
instance:SetAttribute("${markerAttribute}", true)
instance.Parent = parent
return "ok"`;
}

async function insertScript(
  connection: StudioConnection,
  studioId: string,
  parentPath: string,
  name: string,
  className: string,
  source: string,
): Promise<void> {
  await executeLuau(connection, studioId, createLuau(parentPath, name, className));
  for (let start = 0; start < source.length; start += sourceChunkLength) {
    const chunk = source.slice(start, start + sourceChunkLength);
    await executeLuau(
      connection,
      studioId,
      `
local ServerScriptService = game:GetService("ServerScriptService")
local target = ${parentPath}:FindFirstChild("${name}")
assert(target, "${name} was not inserted")
target.Source ..= ${longString(chunk)}
return "ok"`,
    );
  }
}

async function runSmoke(connection: StudioConnection, studioId: string): Promise<string> {
  const taken = await executeLuau(connection, studioId, preflightLuau);
  if (taken !== "")
    throw new Error(`ServerScriptService already holds ${taken}; remove it and rerun`);

  await executeLuau(
    connection,
    studioId,
    createLuau("ServerScriptService", packagesFolderName, "Folder"),
  );
  await insertScript(
    connection,
    studioId,
    `ServerScriptService:FindFirstChild("${packagesFolderName}")`,
    "ProfileStore",
    "ModuleScript",
    await readFile(await profileStorePath(), "utf8"),
  );
  for (const template of templates) {
    await insertScript(
      connection,
      studioId,
      "ServerScriptService",
      template.name,
      template.className,
      await readFile(new URL(template.file, templateFolder), "utf8"),
    );
  }

  const tool = createRunPlaytestTool();
  const input = tool.inputSchema.parse({
    mode: "play",
    serverChecks: dataChecksBody,
    timeoutSeconds: playtestTimeoutSeconds,
    studioId,
  });
  const result = await tool.handler(input, { studio: connection });
  if (result.isError === true) throw new Error(`run_playtest returned an error: ${textOf(result)}`);
  const output = tool.outputSchema.parse(result.structuredContent);
  const failed = output.peers.flatMap((peer) =>
    peer.checks.filter((entry) => !entry.passed).map((entry) => `${entry.name}: ${entry.detail}`),
  );
  if (!output.passed || output.checks.total === 0 || output.errors.length > 0) {
    throw new Error(
      `data playtest failed (${String(output.checks.failed)} of ${String(output.checks.total)} checks): ${JSON.stringify({ failed, errors: output.errors })}`,
    );
  }
  return `passed, ${String(output.checks.total)} checks in ${String(output.durationMs)} ms`;
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
    const removed = await executeLuau(connection, studioId, cleanupLuau);
    console.log(`removed ${removed} inserted instances`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
}
