import { readFile } from "node:fs/promises";
import { config } from "../src/config.ts";
import { createRunPlaytestTool } from "../src/playtest/run-playtest-tool.ts";
import { selectStudio, type StudioConnection } from "../src/studio/studio-connection.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";
import { executeLuau, insertScript, removeMarked, textOf } from "./studio-insert.ts";

/**
 * End-to-end check of the `networking` skill templates in the open place: inserts the generated Blink server
 * module and the templates under ServerScriptService and the generated client module and NetworkClientChecks
 * under ReplicatedStorage, runs the bad-data checks in a solo `play` playtest and removes everything it inserted,
 * even after a failure. Rerun it before bumping Blink: the raw-buffer checks depend on the 0.18.9 wire format.
 */
const templateFolder = new URL("../skills/networking/templates/", import.meta.url);
const generatedFolder = new URL("network/generated/", templateFolder);
const markerAttribute = "RobloxKitNetworkingSmoke";
const playtestTimeoutSeconds = 120;

interface Insertion {
  service: "ServerScriptService" | "ReplicatedStorage";
  name: string;
  className: "ModuleScript" | "Script";
  folder: URL;
  file: string;
}
// Order matters only for readability: every module is inserted before the playtest starts.
const insertions: Insertion[] = [
  {
    service: "ServerScriptService",
    name: "Network",
    className: "ModuleScript",
    folder: generatedFolder,
    file: "Server.luau",
  },
  {
    service: "ReplicatedStorage",
    name: "Network",
    className: "ModuleScript",
    folder: generatedFolder,
    file: "Client.luau",
  },
  ...["Validate", "RateLimit", "Rejections", "Pickups", "NetworkChecks"].map((name): Insertion => ({
    service: "ServerScriptService",
    name,
    className: "ModuleScript",
    folder: templateFolder,
    file: `${name}.luau`,
  })),
  {
    service: "ServerScriptService",
    name: "Main",
    className: "Script",
    folder: templateFolder,
    file: "Main.server.luau",
  },
  {
    service: "ReplicatedStorage",
    name: "NetworkClientChecks",
    className: "ModuleScript",
    folder: templateFolder,
    file: "NetworkClientChecks.luau",
  },
];

const serverChecksBody = `require(game:GetService("ServerScriptService"):WaitForChild("NetworkChecks"))(check, expectedClients)`;
const clientChecksBody = `require(game:GetService("ReplicatedStorage"):WaitForChild("NetworkClientChecks"))(check, player)`;

/** The instances the smoke would shadow, as `Parent.Name`: the inserted modules plus the `Pickups` folder the checks use. */
const takenPaths = [
  ...insertions.map((insertion) => `${insertion.service}.${insertion.name}`),
  "Workspace.Pickups",
];

/** Fails before inserting anything when the place already has an instance the smoke would shadow. */
const preflightLuau = `
local taken = {}
for _, path in {${takenPaths.map((path) => `"${path}"`).join(", ")}} do
	local service, name = string.match(path, "^(%w+)%.(%w+)$")
	if game:GetService(service):FindFirstChild(name) ~= nil then
		table.insert(taken, path)
	end
end
return table.concat(taken, ", ")`;

async function runSmoke(connection: StudioConnection, studioId: string): Promise<string> {
  const taken = await executeLuau(connection, studioId, preflightLuau);
  if (taken !== "") throw new Error(`The place already holds ${taken}; remove it and rerun`);

  for (const insertion of insertions) {
    await insertScript(
      connection,
      studioId,
      markerAttribute,
      `game:GetService("${insertion.service}")`,
      insertion.name,
      insertion.className,
      await readFile(new URL(insertion.file, insertion.folder), "utf8"),
    );
  }

  const tool = createRunPlaytestTool();
  const input = tool.inputSchema.parse({
    mode: "play",
    serverChecks: serverChecksBody,
    clientChecks: clientChecksBody,
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
      `networking playtest failed (${String(output.checks.failed)} of ${String(output.checks.total)} checks): ${JSON.stringify({ failed, errors: output.errors })}`,
    );
  }
  return `passed, ${String(output.checks.total)} checks in ${String(output.durationMs)} ms`;
}

const connection = new StudioMcpClient({
  clientInfo: { name: `${config.serverName}-smoke-networking`, version: config.serverVersion },
  timeoutMs: config.upstreamTimeoutMs,
});
try {
  const studioId = await selectStudio(connection, undefined);
  try {
    console.log(await runSmoke(connection, studioId));
  } finally {
    for (const service of ["ServerScriptService", "ReplicatedStorage"]) {
      // One service failing to clean up must not leave the other one dirty.
      try {
        const removed = await removeMarked(connection, studioId, service, markerAttribute);
        console.log(`removed ${removed} inserted instances from ${service}`);
      } catch (error) {
        console.error(
          `cleanup of ${service} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
}
