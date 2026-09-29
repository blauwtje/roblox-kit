import { z } from "zod";
import { config } from "../src/config.ts";
import { runLuauFile } from "../src/luau/run-luau-file.ts";
import { buildMapTool } from "../src/map/build-map-tool.ts";
import { captureZonesTool } from "../src/map/capture-zones-tool.ts";
import { CheckReportStore } from "../src/map/check-report-store.ts";
import { createCheckMapTool } from "../src/map/check-map-tool.ts";
import { layoutMap } from "../src/map/map-layout.ts";
import { mapSpecSchema } from "../src/map/map-spec.ts";
import { loadPresets } from "../src/style/load-preset.ts";
import { createRunPlaytestTool } from "../src/playtest/run-playtest-tool.ts";
import type { ToolDefinition } from "../src/server/tool-definition.ts";
import { selectStudio, type StudioConnection } from "../src/studio/studio-connection.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";

const presets = await loadPresets();

const capabilitiesSchema = z.array(
  z.object({ capability: z.string(), ok: z.boolean(), detail: z.string() }),
);
type Capability = z.output<typeof capabilitiesSchema>[number];

/** Characters the probe asks `execute_luau` for: well past its limit, so the cut must show. */
const oversizedResultLength = config.executeLuauMaxResultChars * 10;

/** Runs one tool call and turns its outcome into a capability entry. */
async function probeTool(capability: string, attempt: () => Promise<string>): Promise<Capability> {
  try {
    return { capability, ok: true, detail: await attempt() };
  } catch (error) {
    return {
      capability,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeLargeResult(connection: StudioConnection, studioId: string): Promise<string> {
  const result = await connection.callTool({
    name: "execute_luau",
    studioId,
    arguments: {
      code: `return string.rep("x", ${String(oversizedResultLength)})`,
      datamodel_type: "Edit",
    },
  });
  const returnedText = result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  const expectedText =
    "x".repeat(config.executeLuauMaxResultChars) + config.executeLuauTruncationMarker;
  if (result.isError === true || returnedText !== expectedText) {
    throw new Error(
      `asked for ${String(oversizedResultLength)} characters, expected ${String(expectedText.length)} (${String(config.executeLuauMaxResultChars)} then the truncation marker), got ${String(returnedText.length)} ending in ${JSON.stringify(returnedText.slice(-config.executeLuauTruncationMarker.length))}`,
    );
  }
  return `${String(config.executeLuauMaxResultChars)} characters, then the truncation marker`;
}

async function probeScreenCapture(connection: StudioConnection, studioId: string): Promise<string> {
  const result = await connection.callTool({
    name: "screen_capture",
    studioId,
    arguments: {
      capture_id: "roblox-kit-probe",
      camera_position: [0, 40, 40],
      look_at_position: [0, 0, 0],
    },
  });
  const blockTypes = result.content.map((block) => block.type);
  if (result.isError === true || !blockTypes.includes("image")) {
    throw new Error(`no image content; blocks: ${JSON.stringify(result.content).slice(0, 300)}`);
  }
  return `content blocks: ${blockTypes.join(", ")}`;
}

async function probeCapabilities(connection: StudioConnection): Promise<Capability[]> {
  const studioId = await selectStudio(connection, undefined);
  const luauCapabilities = await runLuauFile({
    connection,
    studioId,
    fileName: "probe-capabilities.luau",
    datamodelType: "Edit",
    arguments: null,
    resultSchema: capabilitiesSchema,
  });
  return [
    ...luauCapabilities,
    await probeTool("execute_luau large result", () => probeLargeResult(connection, studioId)),
    await probeTool("screen_capture image content", () => probeScreenCapture(connection, studioId)),
  ];
}

/**
 * A fixed 3-room map far from the place's Baseplate (x and z near 2000), so everything the smoke
 * builds, fills and removes lies outside what the place owns.
 */
const smokeMapSpec = mapSpecSchema.parse({
  mapId: "roblox-kit-smoke",
  style: { preset: "train-station" },
  seed: 1,
  rooms: [
    {
      name: "hall",
      x: 2000,
      z: 2000,
      width: 20,
      depth: 20,
      spawn: true,
      doors: [{ side: "east" }],
    },
    {
      name: "vault",
      x: 2020,
      z: 2000,
      width: 20,
      depth: 20,
      doors: [{ side: "west" }, { side: "east" }],
    },
    { name: "yard", x: 2040, z: 2000, width: 20, depth: 20, doors: [{ side: "west" }] },
  ],
  terrain: [
    {
      shape: "block",
      center: { x: 2020, y: -12, z: 2000 },
      size: { x: 60, y: 8, z: 20 },
      material: "Grass",
    },
  ],
});

/** Studs box (min, max) around everything the smoke can touch; cleared to Air and asserted empty. */
const smokeRegion = { min: [1960, -30, 1960], max: [2080, 30, 2040] };

/** What must remain in Workspace once the smoke is done. */
const placeWorkspaceChildren = ["Terrain", "Baseplate", "SpawnLocation", "Camera"];

/** Removes what the smoke and the tools insert: only names and the region the smoke owns. */
const cleanupLuau = `
local ServerScriptService = game:GetService("ServerScriptService")
local StarterPlayerScripts = game:GetService("StarterPlayer"):FindFirstChildOfClass("StarterPlayerScripts")
local function destroyNamed(container, name)
  if container == nil then return end
  for _, child in container:GetChildren() do
    if child.Name == name then child:Destroy() end
  end
end
destroyNamed(workspace, "${config.mapsFolderName}")
for _, variant in game:GetService("MaterialService"):GetChildren() do
  if variant:IsA("MaterialVariant") and string.sub(variant.Name, 1, ${String(smokeMapSpec.mapId.length + 1)}) == "${smokeMapSpec.mapId}-" then variant:Destroy() end
end
destroyNamed(ServerScriptService, "RobloxKitPlaytestServerHarness")
destroyNamed(StarterPlayerScripts, "RobloxKitPlaytestClientHarness")
local min = Vector3.new(${smokeRegion.min.join(", ")})
local max = Vector3.new(${smokeRegion.max.join(", ")})
workspace.Terrain:FillBlock(CFrame.new((min + max) / 2), max - min, Enum.Material.Air)
return "cleaned"`;

/** Reports the place state as one line; the smoke fails unless it is the state the place started in. */
const placeStateLuau = `
local names = {}
for _, child in workspace:GetChildren() do table.insert(names, child.Name) end
table.sort(names)
local storage = game:GetService("ServerStorage"):GetChildren()
local min = Vector3.new(${smokeRegion.min.join(", ")})
local max = Vector3.new(${smokeRegion.max.join(", ")})
local voxels = workspace.Terrain:ReadVoxels(Region3.new(min, max):ExpandToGrid(4), 4)
local solid = 0
for x = 1, voxels.Size.X do
  for y = 1, voxels.Size.Y do
    for z = 1, voxels.Size.Z do
      if voxels[x][y][z] ~= Enum.Material.Air then solid += 1 end
    end
  end
end
local smokeVariants = 0
for _, variant in game:GetService("MaterialService"):GetChildren() do
  if string.sub(variant.Name, 1, ${String(smokeMapSpec.mapId.length + 1)}) == "${smokeMapSpec.mapId}-" then smokeVariants += 1 end
end
local harnesses = 0
for _, name in { "RobloxKitPlaytestServerHarness", "RobloxKitPlaytestClientHarness" } do
  if game:GetService("ServerScriptService"):FindFirstChild(name) then harnesses += 1 end
  local scripts = game:GetService("StarterPlayer"):FindFirstChildOfClass("StarterPlayerScripts")
  if scripts and scripts:FindFirstChild(name) then harnesses += 1 end
end
return game:GetService("HttpService"):JSONEncode({
  workspace = names, smokeVariants = smokeVariants, serverStorage = #storage, solidTerrainVoxels = solid, harnesses = harnesses,
})`;

const placeStateSchema = z.object({
  workspace: z.array(z.string()),
  serverStorage: z.number(),
  solidTerrainVoxels: z.number(),
  smokeVariants: z.number(),
  harnesses: z.number(),
});

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
  if (result.isError === true) {
    throw new Error(`execute_luau failed: ${textOf(result)}`);
  }
  return textOf(result);
}

function expectEqual(what: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Calls a tool the way the server registry does: input parsed by its schema, output by its own. */
async function callRealTool<Input extends z.ZodObject, Output extends z.ZodObject>(
  tool: ToolDefinition<Input, Output>,
  rawInput: z.input<Input>,
  connection: StudioConnection,
) {
  const result = await tool.handler(tool.inputSchema.parse(rawInput), { studio: connection });
  if (result.isError === true) {
    throw new Error(`${tool.name} returned an error: ${textOf(result)}`);
  }
  const output = tool.outputSchema.parse(result.structuredContent);
  return { output, content: result.content };
}

async function probeBuildMap(connection: StudioConnection): Promise<string> {
  const layout = layoutMap(smokeMapSpec);
  const { output } = await callRealTool(buildMapTool, smokeMapSpec, connection);
  expectEqual("build_map mapId", output.mapId, smokeMapSpec.mapId);
  expectEqual("build_map partCount", output.partCount, layout.parts.length);
  expectEqual(
    "build_map zones",
    output.zones.map((zone) => zone.name),
    smokeMapSpec.rooms.map((room) => room.name),
  );
  expectEqual(
    "build_map zone part counts sum",
    output.zones.reduce((sum, zone) => sum + zone.partCount, 0),
    layout.parts.length,
  );
  return `${String(output.partCount)} parts in ${String(output.zones.length)} zones`;
}

/** What the built map shows in Studio: palette colors on every floor and wall, the wall variant on the walls. */
const paintedMapLuau = `
local model = workspace:WaitForChild("${config.mapsFolderName}"):WaitForChild("${smokeMapSpec.mapId}")
local variant = game:GetService("MaterialService"):FindFirstChild("${smokeMapSpec.mapId}-wall")
local painted = { floors = {}, walls = {}, wallVariants = {}, variantBase = "", variantStuds = 0 }
for _, part in model:GetChildren() do
  local list = if string.find(part.Name, "floor", 1, true) then painted.floors elseif string.find(part.Name, "wall", 1, true) then painted.walls else nil
  if list then table.insert(list, part.Color:ToHex()) end
  if list == painted.walls then table.insert(painted.wallVariants, part.MaterialVariant) end
end
if variant and variant:IsA("MaterialVariant") then
  painted.variantBase = variant.BaseMaterial.Name
  painted.variantStuds = variant.StudsPerTile
end
return game:GetService("HttpService"):JSONEncode(painted)`;

const paintedMapSchema = z.object({
  floors: z.array(z.string()),
  walls: z.array(z.string()),
  wallVariants: z.array(z.string()),
  variantBase: z.string(),
  variantStuds: z.number(),
});

async function probePaintedMap(connection: StudioConnection): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  const painted = paintedMapSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, paintedMapLuau)),
  );
  const { surfaces } = presets.get("train-station") ?? {};
  const variant = surfaces?.wall.variant;
  if (surfaces === undefined || variant === undefined) {
    throw new Error("The train-station preset no longer names a wall MaterialVariant.");
  }
  const hex = (color: string) => color.slice(1).toLowerCase();
  expectEqual("floor colors", [...new Set(painted.floors)], [hex(surfaces.floor.color)]);
  expectEqual("wall colors", [...new Set(painted.walls)], [hex(surfaces.wall.color)]);
  expectEqual("wall parts built", painted.walls.length > 0, true);
  expectEqual(
    "wall MaterialVariant names",
    [...new Set(painted.wallVariants)],
    [`${smokeMapSpec.mapId}-wall`],
  );
  expectEqual("MaterialVariant base", painted.variantBase, variant.baseMaterial);
  expectEqual("MaterialVariant studsPerTile", painted.variantStuds, variant.studsPerTile);
  return `${String(painted.floors.length)} floors and ${String(painted.walls.length)} walls painted`;
}

async function probeCheckMap(connection: StudioConnection): Promise<string> {
  const tool = createCheckMapTool(new CheckReportStore());
  const { output, content } = await callRealTool(tool, { mapId: smokeMapSpec.mapId }, connection);
  expectEqual("check_map partCount", output.partCount, layoutMap(smokeMapSpec).parts.length);
  expectEqual("check_map zoneCount", output.zoneCount, smokeMapSpec.rooms.length);
  expectEqual("check_map reachabilityChecked", output.reachabilityChecked, true);
  expectEqual(
    "check_map resource_link",
    content.some((block) => block.type === "resource_link"),
    true,
  );
  const counted = output.counts.overlapping + output.counts.floating + output.counts.unreachable;
  expectEqual("check_map issues + omitted", output.issues.length + output.issuesOmitted, counted);
  expectEqual("check_map passed", output.passed, counted === 0);
  // A clean map: any issue here is a finding, not something to tolerate.
  expectEqual("check_map counts", output.counts, { overlapping: 0, floating: 0, unreachable: 0 });
  return `passed=${String(output.passed)} counts=${JSON.stringify(output.counts)}`;
}

async function probeCaptureZones(connection: StudioConnection): Promise<string> {
  const { output, content } = await callRealTool(
    captureZonesTool,
    { mapId: smokeMapSpec.mapId },
    connection,
  );
  const images = content.filter((block) => block.type === "image");
  expectEqual(
    "capture_zones shot zones",
    output.shots.map((shot) => shot.zone),
    smokeMapSpec.rooms.map((room) => room.name),
  );
  expectEqual("capture_zones image count", images.length, smokeMapSpec.rooms.length);
  return `${String(images.length)} images, one per zone`;
}

const playServerChecks = `
local maps = workspace:FindFirstChild("${config.mapsFolderName}")
check("map model present", maps ~= nil and maps:FindFirstChild("${smokeMapSpec.mapId}") ~= nil, "Workspace.${config.mapsFolderName}")
check("clients expected", expectedClients == 1, "expectedClients " .. tostring(expectedClients))
local args = game:GetService("StudioTestService"):GetTestArgs()
check("GetTestArgs is a table", typeof(args) == "table", typeof(args))`;

const playClientChecks = `
check("player named", player.Name ~= "", player.Name)
check("map replicated", workspace:WaitForChild("${config.mapsFolderName}", 10) ~= nil, "client sees the maps folder")`;

async function probePlaytest(
  connection: StudioConnection,
  input: Parameters<ReturnType<typeof createRunPlaytestTool>["handler"]>[0],
  expectedPeers: number,
): Promise<string> {
  const { output } = await callRealTool(createRunPlaytestTool(), input, connection);
  if (!output.passed || output.peers.length !== expectedPeers) {
    throw new Error(
      `playtest did not pass with ${String(expectedPeers)} peers: ${JSON.stringify(output)}`,
    );
  }
  return `passed, ${String(output.checks.total)} checks over ${String(output.peers.length)} peers in ${String(output.durationMs)} ms`;
}

/** Builds the smoke map, drives the tools against it and always removes what it inserted. */
async function probeMapTools(connection: StudioConnection): Promise<Capability[]> {
  const studioId = await selectStudio(connection, undefined);
  const findings: Capability[] = [];
  await executeLuau(connection, studioId, cleanupLuau);
  try {
    const steps: [string, () => Promise<string>][] = [
      ["build_map", () => probeBuildMap(connection)],
      ["build_map palette colors and MaterialVariant", () => probePaintedMap(connection)],
      ["check_map", () => probeCheckMap(connection)],
      ["capture_zones", () => probeCaptureZones(connection)],
      [
        "run_playtest play with a server and a client check",
        () =>
          probePlaytest(
            connection,
            {
              mode: "play",
              serverChecks: playServerChecks,
              clientChecks: playClientChecks,
              timeoutSeconds: 30,
            },
            2,
          ),
      ],
      [
        "run_playtest multiplayer with 2 players",
        () =>
          probePlaytest(
            connection,
            {
              mode: "multiplayer",
              players: 2,
              serverChecks: `check("two clients expected", expectedClients == 2, tostring(expectedClients))\ncheck("GetTestArgs is a table", typeof(game:GetService("StudioTestService"):GetTestArgs()) == "table", "")`,
              clientChecks: playClientChecks,
              timeoutSeconds: 40,
            },
            3,
          ),
      ],
    ];
    for (const [capability, attempt] of steps) {
      findings.push(await probeTool(capability, attempt));
    }
  } finally {
    await executeLuau(connection, studioId, cleanupLuau);
  }
  const state = placeStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, placeStateLuau)),
  );
  findings.push(
    await probeTool("place restored after the smoke", () => {
      expectEqual(
        "Workspace children",
        [...state.workspace].sort(),
        [...placeWorkspaceChildren].sort(),
      );
      expectEqual("ServerStorage children", state.serverStorage, 0);
      expectEqual("terrain voxels over the map region", state.solidTerrainVoxels, 0);
      expectEqual("harness scripts left", state.harnesses, 0);
      expectEqual("smoke MaterialVariants left", state.smokeVariants, 0);
      return Promise.resolve(JSON.stringify(state));
    }),
  );
  return findings;
}

const connection = new StudioMcpClient({
  clientInfo: { name: `${config.serverName}-smoke`, version: config.serverVersion },
  timeoutMs: config.upstreamTimeoutMs,
});
try {
  const capabilities = [
    ...(await probeCapabilities(connection)),
    ...(await probeMapTools(connection)),
  ];
  console.log(JSON.stringify(capabilities, null, 2));
  process.exitCode = capabilities.every((entry) => entry.ok) ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
}
