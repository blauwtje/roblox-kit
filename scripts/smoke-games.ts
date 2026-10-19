import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { config } from "../src/config.ts";
import { awaitEditMode } from "../src/studio/await-edit-mode.ts";
import type { StudioConnection } from "../src/studio/studio-connection.ts";
import { runScript, withStudio } from "./lib/run-script.ts";
import { checksFileName, classifyGameFile, type GameFilePlacement } from "./lib/game-files.ts";
import { executeLuau, insertScript, runSmokePlaytest, textOf } from "./studio-insert.ts";

/**
 * End-to-end check of the `game-formula` templates in the open place. For each game it inserts
 * `templates/juice/*` and the game's files (class and parent by file suffix, see `scripts/lib/game-files.ts`),
 * runs the game's `Checks.luau` as the serverChecks body of a solo `play` playtest, then starts a second solo
 * play session and takes the three `Shot1..3` views of `Workspace.GameFormula*.Shots` with Studio's
 * `screen_capture` (it moves the camera itself from camera_position and look_at_position). Images are saved
 * to `.roblox-kit/game-shots/<game>/shot-N.<ext>`. Everything inserted is removed in a finally block, also
 * after a failure. Run `--help` for usage.
 */
const templatesFolder = new URL("../skills/game-formula/templates/", import.meta.url);
const shotsFolder = fileURLToPath(new URL("../.roblox-kit/game-shots/", import.meta.url));
const markerAttribute = "RobloxKitGameSmoke";
const games = ["steal-egg", "plus-one-escape"] as const;
const playtestTimeoutSeconds = 120;
const shotWaitSeconds = 45;
const shotNames = ["Shot1", "Shot2", "Shot3"] as const;
/** How far ahead of a Shot's CFrame the camera looks, in studs. */
const shotLookDistance = 40;

async function luauFiles(folder: string): Promise<string[]> {
  const names = await readdir(new URL(`${folder}/`, templatesFolder));
  return names.filter((name) => name.endsWith(".luau")).sort();
}

interface Insertion {
  folder: string;
  fileName: string;
  placement: GameFilePlacement;
}

async function plan(game: string): Promise<{ insertions: Insertion[]; checks: string }> {
  const insertions: Insertion[] = [];
  for (const folder of ["juice", game]) {
    for (const fileName of await luauFiles(folder)) {
      const placement = classifyGameFile(fileName);
      if (placement !== undefined) insertions.push({ folder, fileName, placement });
    }
  }
  const body = await readFile(new URL(`${game}/${checksFileName}`, templatesFolder), "utf8");
  return { insertions, checks: checksHarnessBody(body) };
}

/**
 * A template's `Checks.luau` error()s on its first failure and otherwise returns a summary table, while the
 * run_playtest harness counts only `check(name, passed, detail)` calls. This runs the body as an inner function
 * (its error reaches the harness, which records it as a failed check) and records one passed check per summary
 * key, sorted, with the value JSON-encoded as the detail.
 */
function checksHarnessBody(body: string): string {
  return `local summary = (function(): any
${body}
end)()
check("Checks.luau ran to the end", typeof(summary) == "table", typeof(summary))
if typeof(summary) == "table" then
	local keys = {}
	for key in summary do
		table.insert(keys, tostring(key))
	end
	table.sort(keys)
	for _, key in keys do
		local value = summary[key]
		check(key, true, if typeof(value) == "string" then value else game:GetService("HttpService"):JSONEncode(value))
	end
end`;
}

/** Fails before inserting when the place already has an instance with a name the smoke would shadow. */
function preflightLuau(names: string[]): string {
  const quoted = names.map((name) => `"${name}"`).join(", ");
  return `
local containers = {
	game:GetService("ReplicatedStorage"),
	game:GetService("ServerScriptService"),
	game:GetService("StarterPlayer"):FindFirstChild("StarterPlayerScripts"),
}
local taken = {}
for _, container in containers do
	for _, name in {${quoted}} do
		if container:FindFirstChild(name) ~= nil then
			table.insert(taken, container.Name .. "." .. name)
		end
	end
end
return table.concat(taken, ", ")`;
}

const cleanupAllLuau = `
local removed = 0
for _, container in {
	game:GetService("ReplicatedStorage"),
	game:GetService("ServerScriptService"),
	game:GetService("StarterPlayer"):FindFirstChild("StarterPlayerScripts"),
} do
	for _, child in container:GetChildren() do
		if child:GetAttribute("${markerAttribute}") == true then
			child:Destroy()
			removed += 1
		end
	end
end
return tostring(removed)`;

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

const shotSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]),
  lookAt: z.tuple([z.number(), z.number(), z.number()]),
});

/** Runs in the playtest server: waits for Workspace.GameFormula*.Shots and returns each Shot's camera view. */
const readShotsLuau = `
local HttpService = game:GetService("HttpService")
local deadline = os.clock() + ${String(shotWaitSeconds)}
local function cframeOf(item)
	if item:IsA("BasePart") or item:IsA("Camera") then
		return item.CFrame
	elseif item:IsA("Attachment") then
		return item.WorldCFrame
	elseif item:IsA("CFrameValue") then
		return item.Value
	end
	return nil
end
repeat
	for _, child in workspace:GetChildren() do
		if string.sub(child.Name, 1, 11) == "GameFormula" then
			local shots = child:FindFirstChild("Shots")
			if shots ~= nil then
				local views = {}
				for _, name in {${shotNames.map((name) => `"${name}"`).join(", ")}} do
					local item = shots:FindFirstChild(name)
					local cf = item and cframeOf(item)
					if cf == nil then
						views = nil
						break
					end
					local look = cf.Position + cf.LookVector * ${String(shotLookDistance)}
					table.insert(views, {
						position = { cf.Position.X, cf.Position.Y, cf.Position.Z },
						lookAt = { look.X, look.Y, look.Z },
					})
				end
				if views ~= nil then
					return HttpService:JSONEncode(views)
				end
			end
		end
	end
	task.wait(0.5)
until os.clock() > deadline
error("No Workspace.GameFormula*.Shots with Shot1..3 appeared")`;

async function captureShots(
  connection: StudioConnection,
  studioId: string,
  game: string,
): Promise<string[]> {
  await setPlay(connection, studioId, true);
  try {
    const result = await connection.callTool({
      name: "execute_luau",
      studioId,
      arguments: { code: readShotsLuau, datamodel_type: "Server" },
    });
    if (result.isError === true) throw new Error(`Reading the shots failed: ${textOf(result)}`);
    const views = z
      .array(shotSchema)
      .length(shotNames.length)
      .parse(JSON.parse(textOf(result)));
    const folder = join(shotsFolder, game);
    await mkdir(folder, { recursive: true });
    const paths: string[] = [];
    for (const [index, view] of views.entries()) {
      await new Promise((resolve) => setTimeout(resolve, config.captureCameraSettleMs));
      const capture = await connection.callTool({
        name: "screen_capture",
        studioId,
        arguments: {
          capture_id: `roblox-kit-game-${game}-${String(index + 1)}`,
          camera_position: view.position,
          look_at_position: view.lookAt,
        },
      });
      const image = capture.content.find((block) => block.type === "image");
      if (capture.isError === true || image === undefined) {
        throw new Error(
          `screen_capture of ${shotNames[index] ?? "shot"} returned no image: ${textOf(capture)}`,
        );
      }
      const extension = image.mimeType === "image/png" ? "png" : "jpg";
      const path = join(folder, `shot-${String(index + 1)}.${extension}`);
      await writeFile(path, Buffer.from(image.data, "base64"));
      paths.push(path);
    }
    return paths;
  } finally {
    await setPlay(connection, studioId, false);
  }
}

async function runGame(
  connection: StudioConnection,
  studioId: string,
  game: string,
): Promise<void> {
  const { insertions, checks } = await plan(game);
  const taken = await executeLuau(
    connection,
    studioId,
    preflightLuau(insertions.map((entry) => entry.placement.name)),
  );
  if (taken !== "") throw new Error(`The place already holds ${taken}; remove it and rerun`);
  try {
    for (const { folder, fileName, placement } of insertions) {
      await insertScript(
        connection,
        studioId,
        markerAttribute,
        placement.parent,
        placement.name,
        placement.className,
        await readFile(new URL(`${folder}/${fileName}`, templatesFolder), "utf8"),
      );
    }
    console.log(`[${game}] inserted ${String(insertions.length)} scripts`);
    const summary = await runSmokePlaytest(connection, studioId, game, {
      serverChecks: checks,
      timeoutSeconds: playtestTimeoutSeconds,
      onChecks: (lines) => {
        for (const line of lines) console.log(`[${game}] ${line}`);
      },
    });
    console.log(`[${game}] ${summary}`);
    await awaitEditMode(connection, { studioId });
    for (const path of await captureShots(connection, studioId, game)) {
      console.log(`[${game}] saved ${path}`);
    }
  } finally {
    await awaitEditMode(connection, { studioId });
    const removed = await executeLuau(connection, studioId, cleanupAllLuau);
    console.log(`[${game}] removed ${removed} inserted instances`);
  }
}

await runScript({
  name: "smoke-games",
  usage: `Usage: node scripts/smoke-games.ts [--only <game>]
Inserts skills/game-formula/templates/juice and each game's files into the open place, runs the game's
Checks.luau in a solo playtest, captures Workspace.GameFormula*.Shots Shot1..3 and removes everything.
Games: ${games.join(", ")}. Shots go to .roblox-kit/game-shots/<game>/shot-N.<png|jpg>.`,
  options: { only: { type: "string" } },
  run: async (values) => {
    const only = typeof values.only === "string" ? values.only : undefined;
    if (only !== undefined && !(games as readonly string[]).includes(only)) {
      throw new Error(`Unknown game "${only}"; expected one of ${games.join(", ")}.`);
    }
    const selected = games.filter((game) => only === undefined || game === only);
    await withStudio({ name: "smoke-games" }, async (connection, studioId) => {
      for (const game of selected) await runGame(connection, studioId, game);
    });
    return 0;
  },
});
