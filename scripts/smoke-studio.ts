import { parseArgs } from "node:util";
import { z } from "zod";
import { config } from "../src/config.ts";
import { runLuauFile } from "../src/luau/run-luau-file.ts";
import { buildMapTool, propsOf } from "../src/map/build-map-tool.ts";
import { captureZonesTool } from "../src/map/capture-zones-tool.ts";
import { CheckReportStore } from "../src/map/check-report-store.ts";
import { createCheckMapTool } from "../src/map/check-map-tool.ts";
import { removeMapTool } from "../src/map/remove-map-tool.ts";
import { placeLights } from "../src/lighting/light-placement.ts";
import { layoutMap } from "../src/map/map-layout.ts";
import { relationMapSpecSchema } from "../src/map/map-spec.ts";
import type { PropRecord } from "../src/map/prop-placement.ts";
import type { SetPieceRecord } from "../src/map/set-piece-placement.ts";
import { buildRoomDetails } from "../src/map/room-details.ts";
import { resolveRelations } from "../src/map/relation-solver.ts";
import { loadPresets } from "../src/style/load-preset.ts";
import { createRunPlaytestTool } from "../src/playtest/run-playtest-tool.ts";
import type { ToolDefinition } from "../src/server/tool-definition.ts";
import { selectStudio, type StudioConnection } from "../src/studio/studio-connection.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";
import { awaitEditMode } from "../src/studio/await-edit-mode.ts";
import { assertViewportVisible } from "../src/studio/viewport-preflight.ts";

const presets = await loadPresets();

/**
 * Server & Clients opens one Studio window per player, so it runs only on `--multiplayer`.
 * `--only a,b` runs only the map-tool steps whose name contains one of the comma-separated terms,
 * plus build_map, which the others use, and the place-restored check; it skips the capability probes.
 */
const { values: smokeOptions } = parseArgs({
  options: { multiplayer: { type: "boolean" }, only: { type: "string" } },
});
const onlyTerms = smokeOptions.only
  ?.split(",")
  .map((term) => term.trim())
  .filter((term) => term !== "");

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
 * builds, fills and removes lies outside what the place owns. The vault and the yard are placed by
 * relation, so the map also has two hallway zones. The hall, vault and yard take the train-station room
 * types concourse, ticket-hall and platform, so the map also has set pieces.
 */
/** No bundled preset sets a MaterialVariant, so the smoke asks for one to probe that build_map applies it. */
const smokeWallVariant = { baseMaterial: "Brick", studsPerTile: 8 };

const smokeRelationSpec = relationMapSpecSchema.parse({
  mapId: "roblox-kit-smoke",
  style: {
    preset: "train-station",
    overrides: { surfaces: { wall: { variant: smokeWallVariant } } },
  },
  seed: 1,
  // At the train-station size rules, so check_map with the preset reports no sizeRule issue.
  wallHeight: 16,
  doorWidth: 10,
  rooms: [
    { name: "hall", x: 2000, z: 2000, width: 20, depth: 20, spawn: true, roomType: "concourse" },
    {
      name: "vault",
      roomType: "ticket-hall",
      width: 20,
      depth: 20,
      relation: { to: "hall", direction: "east", hallwayLength: 14, hallwayWidth: 14 },
    },
    {
      name: "yard",
      roomType: "platform",
      width: 20,
      depth: 20,
      relation: { to: "vault", direction: "east", hallwayLength: 14, hallwayWidth: 14 },
    },
  ],
  terrain: [
    {
      shape: "block",
      center: { x: 2035, y: -12, z: 2000 },
      size: { x: 90, y: 8, z: 20 },
      material: "Grass",
    },
  ],
});

/** The smoke map with every room centered: what layout, lights and the checks below expect. */
const smokeMapSpec = resolveRelations(smokeRelationSpec);

/** Studs box (min, max) around everything the smoke can touch; cleared to Air and asserted empty. */
const smokeRegion = { min: [1960, -30, 1960], max: [2100, 30, 2100] };

/** Name of the Model the blocker probe puts beside the smoke map; the cleanup removes it by name. */
const blockerModelName = `${smokeMapSpec.mapId}-blocker`;

/** A second styled map south of the smoke map, inside the smoke region, for the lighting rule across two maps. */
const secondSmokeSpec = relationMapSpecSchema.parse({
  mapId: `${smokeMapSpec.mapId}-b`,
  style: { preset: "train-station" },
  seed: 1,
  wallHeight: 16,
  doorWidth: 10,
  rooms: [
    { name: "hall", x: 2000, z: 2070, width: 20, depth: 20, spawn: true, roomType: "concourse" },
  ],
});

/** Puts Lighting back from the snapshot the map Model holds; it must run before the Model is destroyed. */
const restoreLightingLuau = `
local Lighting = game:GetService("Lighting")
local mapsFolder = workspace:FindFirstChild("${config.mapsFolderName}")
local mapModel = if mapsFolder then mapsFolder:FindFirstChild("${smokeMapSpec.mapId}") else nil
local encoded = if mapModel then mapModel:GetAttribute("RobloxKitLightingSnapshot") else nil
if typeof(encoded) == "string" then
  local snapshot = game:GetService("HttpService"):JSONDecode(encoded)
  for name, value in snapshot.lighting do
    if name == "LightingStyle" then Lighting.LightingStyle = Enum.LightingStyle[value]
    elseif name == "Ambient" or name == "OutdoorAmbient" then Lighting[name] = Color3.fromHex(value)
    else Lighting[name] = value end
  end
  local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere")
  if atmosphere and snapshot.atmosphere then
    for name, value in snapshot.atmosphere do
      if name == "Color" or name == "Decay" then atmosphere[name] = Color3.fromHex(value) else atmosphere[name] = value end
    end
  end
  local bloom = Lighting:FindFirstChildOfClass("BloomEffect")
  if bloom and snapshot.bloom then
    for name, value in snapshot.bloom do bloom[name] = value end
  end
  for _, className in snapshot.created do
    local effect = Lighting:FindFirstChildOfClass(className)
    if effect then effect:Destroy() end
  end
end`;

/** Removes what the smoke and the tools insert: only names and the region the smoke owns; other maps stay. */
const cleanupLuau = `${restoreLightingLuau}
local ServerScriptService = game:GetService("ServerScriptService")
local StarterPlayerScripts = game:GetService("StarterPlayer"):FindFirstChildOfClass("StarterPlayerScripts")
local function destroyNamed(container, name)
  if container == nil then return end
  for _, child in container:GetChildren() do
    if child.Name == name then child:Destroy() end
  end
end
local mapsFolder = workspace:FindFirstChild("${config.mapsFolderName}")
destroyNamed(mapsFolder, "${smokeMapSpec.mapId}")
destroyNamed(mapsFolder, "${blockerModelName}")
destroyNamed(mapsFolder, "${secondSmokeSpec.mapId}")
if mapsFolder and #mapsFolder:GetChildren() == 0 then mapsFolder:Destroy() end
for _, variant in game:GetService("MaterialService"):GetChildren() do
  if variant:IsA("MaterialVariant") and string.sub(variant.Name, 1, ${String(smokeMapSpec.mapId.length + 1)}) == "${smokeMapSpec.mapId}-" then variant:Destroy() end
end
destroyNamed(ServerScriptService, "RobloxKitPlaytestServerHarness")
destroyNamed(StarterPlayerScripts, "RobloxKitPlaytestClientHarness")
local min = Vector3.new(${smokeRegion.min.join(", ")})
local max = Vector3.new(${smokeRegion.max.join(", ")})
workspace.Terrain:FillBlock(CFrame.new((min + max) / 2), max - min, Enum.Material.Air)
return "cleaned"`;

/** Reports Lighting as JSON: the recipe's properties and effects, as the smoke compares them. */
const lightingStateLuau = `
local Lighting = game:GetService("Lighting")
local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere")
local bloom = Lighting:FindFirstChildOfClass("BloomEffect")
return game:GetService("HttpService"):JSONEncode({
  LightingStyle = Lighting.LightingStyle.Name,
  Ambient = Lighting.Ambient:ToHex(),
  OutdoorAmbient = Lighting.OutdoorAmbient:ToHex(),
  Brightness = Lighting.Brightness,
  ExposureCompensation = Lighting.ExposureCompensation,
  ShadowSoftness = Lighting.ShadowSoftness,
  effectCount = #Lighting:GetChildren(),
  atmosphereDensity = if atmosphere then atmosphere.Density else -1,
  atmosphereColor = if atmosphere then atmosphere.Color:ToHex() else "",
  bloomIntensity = if bloom then bloom.Intensity else -1,
})`;

const lightingStateSchema = z.object({
  LightingStyle: z.string(),
  Ambient: z.string(),
  OutdoorAmbient: z.string(),
  Brightness: z.number(),
  ExposureCompensation: z.number(),
  ShadowSoftness: z.number(),
  effectCount: z.number(),
  atmosphereDensity: z.number(),
  atmosphereColor: z.string(),
  bloomIntensity: z.number(),
});

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
  await awaitEditMode(connection, { studioId });
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

/** What build_map sends for the styled smoke map: layout with ceilings, trim details and preset props. */
function styledSmokeMap() {
  const preset = presets.get("train-station");
  if (preset === undefined) {
    throw new Error("The train-station preset is missing.");
  }
  const layout = layoutMap(smokeMapSpec, preset.surfaces, { ceilings: true });
  const details = buildRoomDetails(smokeMapSpec, layout.parts, preset.surfaces);
  const { props } = propsOf(smokeMapSpec, preset);
  return { layout, details, props };
}

/** Name ending of the fixture part build_map hangs at each ceiling light. */
const fixtureNameSuffix = "-fixture";

/** The train-station preset's lights on the smoke map, as build_map places them. */
function smokeLightPlacements() {
  const preset = presets.get("train-station");
  if (preset === undefined) {
    throw new Error("The train-station preset is missing.");
  }
  return placeLights(smokeMapSpec, preset.lightRoles, preset.lightFixtures);
}

/** The lights without a fixture box that hang within the ceiling drop of their room's ceiling; build_map shows one cube fixture part for each. */
function ceilingLightPlacements() {
  return smokeLightPlacements().filter((placement) => {
    if (placement.fixture !== undefined) {
      return false;
    }
    const room = smokeMapSpec.rooms.find((candidate) => candidate.x === placement.position.x);
    const wallHeight = room?.wallHeight ?? smokeMapSpec.wallHeight ?? config.defaultWallHeightStuds;
    return wallHeight - placement.position.y <= config.lightCeilingDropStuds;
  });
}

/** The lights a preset's `lightFixtures` placed; build_map builds one box part holding each. */
function fixtureLightPlacements() {
  return smokeLightPlacements().filter((placement) => placement.fixture !== undefined);
}

async function probeBuildMap(connection: StudioConnection): Promise<string> {
  const { layout, details } = styledSmokeMap();
  const zonedPartCount = layout.parts.length + details.length;
  const expectedPartCount =
    zonedPartCount + ceilingLightPlacements().length + fixtureLightPlacements().length;
  const { output } = await callRealTool(buildMapTool, smokeRelationSpec, connection);
  expectEqual("build_map mapId", output.mapId, smokeMapSpec.mapId);
  expectEqual("build_map partCount", output.partCount, expectedPartCount);
  expectEqual(
    "build_map zones",
    output.zones.map((zone) => zone.name),
    smokeMapSpec.rooms.map((room) => room.name),
  );
  expectEqual(
    "build_map zone part counts sum",
    output.zones.reduce((sum, zone) => sum + zone.partCount, 0),
    zonedPartCount,
  );
  return `${String(output.partCount)} parts in ${String(output.zones.length)} zones`;
}

/** The ceilings, generator ModuleScripts and ProceduralModels of the built map, and every BasePart under it. */
const mapDecorLuau = `
local model = workspace:WaitForChild("${config.mapsFolderName}"):WaitForChild("${smokeMapSpec.mapId}")
local ceilings = {}
for _, tagged in game:GetService("CollectionService"):GetTagged("${config.ceilingTag}") do
  if tagged:IsDescendantOf(model) and tagged:IsA("BasePart") then
    table.insert(ceilings, { name = tagged.Name, canCollide = tagged.CanCollide, isNeon = tagged.Material == Enum.Material.Neon, size = tagged.Size.X })
  end
end
local generators, proceduralModels, baseParts = {}, {}, 0
for _, descendant in model:GetDescendants() do
  if descendant:IsA("BasePart") then baseParts += 1 end
  if descendant:IsA("ModuleScript") then table.insert(generators, descendant.Name) end
  if descendant:IsA("ProceduralModel") then
    local generated = 0
    for _, inner in descendant:GetDescendants() do
      if inner:IsA("BasePart") then generated += 1 end
    end
    table.insert(proceduralModels, {
      name = descendant.Name, generationError = descendant.GenerationError, generator = if descendant.Generator then descendant.Generator.Name else "", generatedParts = generated,
      label = descendant:GetAttribute("Label"), accent = if descendant:GetAttribute("AccentColor") then (descendant:GetAttribute("AccentColor") :: Color3):ToHex() else nil,
      yaw = math.round(math.deg(math.atan2(-descendant:GetPivot().LookVector.X, -descendant:GetPivot().LookVector.Z))),
    })
  end
end
table.sort(generators)
table.sort(ceilings, function(first, second) return first.name < second.name end)
table.sort(proceduralModels, function(first, second) return first.name < second.name end)
return game:GetService("HttpService"):JSONEncode({ ceilings = ceilings, generators = generators, proceduralModels = proceduralModels, baseParts = baseParts })`;

const mapDecorSchema = z.object({
  ceilings: z.array(
    z.object({ name: z.string(), canCollide: z.boolean(), isNeon: z.boolean(), size: z.number() }),
  ),
  generators: z.array(z.string()),
  proceduralModels: z.array(
    z.object({
      name: z.string(),
      generationError: z.string(),
      generator: z.string(),
      generatedParts: z.number(),
      label: z.string().optional(),
      accent: z.string().optional(),
      yaw: z.number(),
    }),
  ),
  baseParts: z.number(),
});

async function readMapDecor(connection: StudioConnection) {
  const studioId = await selectStudio(connection, undefined);
  return mapDecorSchema.parse(JSON.parse(await executeLuau(connection, studioId, mapDecorLuau)));
}

/** Proves each set piece in Studio faces its `yaw` and carries its sign's `Label` and `AccentColor`. */
function expectSetPiecesTurnedAndLabeled(
  props: (PropRecord | SetPieceRecord)[],
  names: string[],
  built: z.output<typeof mapDecorSchema>["proceduralModels"],
) {
  const builtByName = new Map(built.map((model) => [model.name, model]));
  let setPieceCount = 0;
  for (const [index, prop] of props.entries()) {
    if (!("yaw" in prop)) {
      continue;
    }
    setPieceCount += 1;
    const name = names[index] ?? "";
    const model = builtByName.get(name);
    expectEqual(`${name} yaw`, ((model?.yaw ?? NaN) + 360) % 360, prop.yaw);
    expectEqual(`${name} Label`, model?.label, prop.attributes["Label"]);
    expectEqual(
      `${name} AccentColor`,
      model?.accent,
      prop.attributes["AccentColor"]?.replace("#", "").toLowerCase(),
    );
  }
  expectEqual("the smoke map has set pieces", setPieceCount > 0, true);
  expectEqual(
    "the smoke map has a sign per typed room door",
    built.some((model) => model.name.startsWith("sign-") && model.label !== undefined),
    true,
  );
}

/** Proves ceilings carry the tag, one generator per prop kind exists and every prop generated parts without error. */
async function probeMapDecor(connection: StudioConnection): Promise<string> {
  const { layout, props } = styledSmokeMap();
  const decor = await readMapDecor(connection);
  const fixtures = decor.ceilings.filter((tagged) => tagged.name.endsWith(fixtureNameSuffix));
  const ceilings = decor.ceilings.filter((tagged) => !tagged.name.endsWith(fixtureNameSuffix));
  expectEqual(
    "ceiling light fixtures tagged",
    fixtures.map((fixture) => fixture.name),
    ceilingLightPlacements()
      .map((placement) => {
        const room = smokeMapSpec.rooms.find((candidate) => candidate.x === placement.position.x);
        return `${room?.name ?? ""}-${placement.role}${fixtureNameSuffix}`;
      })
      .sort(),
  );
  expectEqual(
    "fixtures are Neon cubes of the configured size",
    fixtures.every(
      (fixture) =>
        fixture.isNeon && fixture.size === config.lightFixtureSizeStuds && !fixture.canCollide,
    ),
    true,
  );
  expectEqual(
    "ceiling names tagged",
    ceilings.map((ceiling) => ceiling.name),
    layout.parts
      .filter((part) => part.kind === "ceiling")
      .map((part) => part.name)
      .sort(),
  );
  expectEqual(
    "ceilings collide",
    ceilings.some((ceiling) => ceiling.canCollide),
    false,
  );
  expectEqual(
    "generator ModuleScripts",
    decor.generators,
    [...new Set(props.map((prop) => `${prop.kind}-generator`))].sort(),
  );
  const countByKind = new Map<string, number>();
  const expectedNames = props.map((prop) => {
    const count = (countByKind.get(prop.kind) ?? 0) + 1;
    countByKind.set(prop.kind, count);
    return `${prop.kind}-${String(count)}`;
  });
  expectEqual(
    "ProceduralModel names",
    decor.proceduralModels.map((model) => model.name),
    [...expectedNames].sort(),
  );
  for (const model of decor.proceduralModels) {
    expectEqual(`${model.name} GenerationError`, model.generationError, "");
    expectEqual(
      `${model.name} generator`,
      model.generator,
      `${model.name.replace(/-\d+$/, "")}-generator`,
    );
    expectEqual(`${model.name} generated parts`, model.generatedParts > 0, true);
  }
  expectSetPiecesTurnedAndLabeled(props, expectedNames, decor.proceduralModels);
  return `${String(ceilings.length)} ceilings and ${String(fixtures.length)} fixtures tagged, ${String(decor.generators.length)} generators, ${String(decor.proceduralModels.length)} props generated`;
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
  if (surfaces === undefined) {
    throw new Error("The train-station preset is missing.");
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
  expectEqual("MaterialVariant base", painted.variantBase, smokeWallVariant.baseMaterial);
  expectEqual("MaterialVariant studsPerTile", painted.variantStuds, smokeWallVariant.studsPerTile);
  return `${String(painted.floors.length)} floors and ${String(painted.walls.length)} walls painted`;
}

/** The lights the built map holds (not those inside generated props): each PointLight with its Attachment, the part above it and its world position. */
const mapLightsLuau = `
local model = workspace:WaitForChild("${config.mapsFolderName}"):WaitForChild("${smokeMapSpec.mapId}")
local lights = {}
for _, descendant in model:GetDescendants() do
  if descendant:IsA("PointLight") and not descendant:FindFirstAncestorOfClass("ProceduralModel") then
    local attachment = descendant.Parent :: Attachment
    local position = attachment.WorldPosition
    local holder = attachment.Parent :: BasePart
    table.insert(lights, {
      part = holder.Name, holderNeon = holder.Material == Enum.Material.Neon, holderCeilingTagged = holder:HasTag("${config.ceilingTag}"),
      holderCanCollide = holder.CanCollide, holderSize = { x = holder.Size.X, y = holder.Size.Y, z = holder.Size.Z }, range = descendant.Range, brightness = descendant.Brightness,
      color = descendant.Color:ToHex(), shadows = descendant.Shadows, x = position.X, y = position.Y, z = position.Z,
    })
  end
end
table.sort(lights, function(first, second)
  if first.x ~= second.x then return first.x < second.x end
  if first.y ~= second.y then return first.y < second.y end
  return first.z < second.z
end)
local snapshot = model:GetAttribute("RobloxKitLightingSnapshot")
return game:GetService("HttpService"):JSONEncode({ lights = lights, snapshot = if typeof(snapshot) == "string" then snapshot else "" })`;

const mapLightsSchema = z.object({
  lights: z.array(
    z.object({
      part: z.string(),
      holderNeon: z.boolean(),
      holderCeilingTagged: z.boolean(),
      holderCanCollide: z.boolean(),
      holderSize: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      range: z.number(),
      brightness: z.number(),
      color: z.string(),
      shadows: z.boolean(),
      x: z.number(),
      y: z.number(),
      z: z.number(),
    }),
  ),
  snapshot: z.string(),
});

function expectClose(what: string, actual: number, expected: number): void {
  if (Math.abs(actual - expected) > 1e-3) {
    throw new Error(`${what}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function readMapLights(connection: StudioConnection, studioId: string) {
  return mapLightsSchema.parse(JSON.parse(await executeLuau(connection, studioId, mapLightsLuau)));
}

/** Proves the style's lights hang under their rooms' floors, the recipe reached Lighting and a rebuild keeps the snapshot. */
async function probeLighting(connection: StudioConnection): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  const preset = presets.get("train-station");
  if (preset === undefined) {
    throw new Error("The train-station preset is missing.");
  }
  const hex = (color: string) => color.slice(1).toLowerCase();
  const built = await readMapLights(connection, studioId);
  const placements = smokeLightPlacements().sort(
    (first, second) =>
      first.position.x - second.position.x ||
      first.position.y - second.position.y ||
      first.position.z - second.position.z,
  );
  expectEqual("light count", built.lights.length, placements.length);
  placements.forEach((placement, index) => {
    const light = built.lights[index];
    const roleValues = preset.lightRoles[placement.role];
    if (light === undefined) {
      throw new Error(`No built light for the ${placement.role} placement.`);
    }
    if (placement.fixture === undefined) {
      expectEqual(`${placement.role} light floor part`, light.part, `${placement.zone}-floor`);
    } else {
      expectEqual(
        `${placement.zone} fixture holds its light`,
        light.part.startsWith(`${placement.zone}-${placement.role}-fixture-`),
        true,
      );
      expectEqual(
        `${placement.zone} fixture is Neon and not collidable`,
        light.holderNeon && !light.holderCanCollide,
        true,
      );
      expectEqual(
        `${placement.zone} sconce is not hidden with the ceilings`,
        light.holderCeilingTagged,
        preset.lightFixtures?.kind === "pendant",
      );
      expectClose(`${placement.zone} fixture width`, light.holderSize.x, placement.fixture.size.x);
      expectClose(`${placement.zone} fixture height`, light.holderSize.y, placement.fixture.size.y);
      expectClose(`${placement.zone} fixture depth`, light.holderSize.z, placement.fixture.size.z);
    }
    expectEqual(`${placement.role} light shadows`, light.shadows, placement.shadows);
    expectEqual(`${placement.role} light color`, light.color.toLowerCase(), hex(roleValues.color));
    expectClose(`${placement.role} light range`, light.range, placement.range);
    expectClose(`${placement.role} light brightness`, light.brightness, roleValues.brightness);
    expectClose(`${placement.role} light x`, light.x, placement.position.x);
    expectClose(`${placement.role} light y`, light.y, placement.position.y);
    expectClose(`${placement.role} light z`, light.z, placement.position.z);
  });
  expectEqual("snapshot stored on the map Model", built.snapshot.length > 0, true);

  const recipe = preset.lighting;
  const lighting = lightingStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, lightingStateLuau)),
  );
  expectEqual("Lighting LightingStyle", lighting.LightingStyle, recipe.LightingStyle);
  expectEqual("Lighting Ambient", lighting.Ambient.toLowerCase(), hex(recipe.Ambient));
  expectEqual(
    "Lighting OutdoorAmbient",
    lighting.OutdoorAmbient.toLowerCase(),
    hex(recipe.OutdoorAmbient),
  );
  expectClose("Lighting Brightness", lighting.Brightness, recipe.Brightness);
  expectClose(
    "Lighting ExposureCompensation",
    lighting.ExposureCompensation,
    recipe.ExposureCompensation,
  );
  expectClose("Atmosphere Density", lighting.atmosphereDensity, recipe.Atmosphere.Density);
  expectEqual(
    "Atmosphere Color",
    lighting.atmosphereColor.toLowerCase(),
    hex(recipe.Atmosphere.Color),
  );
  expectClose("Bloom Intensity", lighting.bloomIntensity, recipe.Bloom.Intensity);

  await callRealTool(buildMapTool, smokeRelationSpec, connection);
  const rebuilt = await readMapLights(connection, studioId);
  expectEqual("light count after a rebuild", rebuilt.lights.length, placements.length);
  expectEqual("snapshot kept across a rebuild", rebuilt.snapshot, built.snapshot);
  return `${String(placements.length)} lights under their floors, recipe applied, snapshot kept across a rebuild`;
}

async function probeCheckMap(connection: StudioConnection): Promise<string> {
  const tool = createCheckMapTool(new CheckReportStore());
  const { output, content } = await callRealTool(
    tool,
    { mapId: smokeMapSpec.mapId, preset: smokeRelationSpec.style?.preset, spec: smokeRelationSpec },
    connection,
  );
  // check_map boxes every BasePart under the Model, including the parts the props generated.
  expectEqual("check_map partCount", output.partCount, (await readMapDecor(connection)).baseParts);
  expectEqual("check_map zoneCount", output.zoneCount, smokeMapSpec.rooms.length);
  expectEqual("check_map reachabilityChecked", output.reachabilityChecked, true);
  expectEqual(
    "check_map resource_link",
    content.some((block) => block.type === "resource_link"),
    true,
  );
  const counted =
    output.counts.overlapping +
    output.counts.floating +
    output.counts.unreachable +
    output.counts.placement +
    output.counts.sizeRule +
    output.counts.scale +
    output.counts.rotation;
  expectEqual("check_map issues + omitted", output.issues.length + output.issuesOmitted, counted);
  expectEqual("check_map passed", output.passed, counted === 0);
  // A clean map: any issue here is a finding, not something to tolerate.
  expectEqual("check_map counts", output.counts, {
    overlapping: 0,
    floating: 0,
    unreachable: 0,
    placement: 0,
    sizeRule: 0,
    scale: 0,
    rotation: 0,
  });
  expectEqual(
    "check_map sceneStats zones",
    output.sceneStats.map((sample) => sample.zone).sort(),
    smokeMapSpec.rooms.map((room) => room.name).sort(),
  );
  for (const sample of output.sceneStats) {
    // A zone camera looks at the room's floor and walls: both counts are above zero.
    expectEqual(`check_map sceneStats ${sample.zone} drawCalls > 0`, sample.drawCalls > 0, true);
    expectEqual(`check_map sceneStats ${sample.zone} triangles > 0`, sample.triangles > 0, true);
  }
  expectEqual("check_map budget", output.budget, smokeRelationSpec.performanceBudget);
  // The smoke map is small and nothing else stands in the smoke region: no zone is over budget, no walk blocked.
  expectEqual("check_map withinBudget", output.withinBudget, true);
  expectEqual("check_map warnings", output.warnings, []);
  return `passed=${String(output.passed)} counts=${JSON.stringify(output.counts)} sceneStats=${JSON.stringify(output.sceneStats)}`;
}

/** Walls off the hallway between the hall and the vault with a Model outside the smoke map. */
function blockerLuau(): string {
  const roomNamed = (name: string) => {
    const room = smokeMapSpec.rooms.find((candidate) => candidate.name === name);
    if (room === undefined) throw new Error(`The smoke map has no room "${name}".`);
    return room;
  };
  const hall = roomNamed("hall");
  const vault = roomNamed("vault");
  const hallwayMiddleX = (hall.x + hall.width / 2 + vault.x - vault.width / 2) / 2;
  return `
local model = Instance.new("Model")
model.Name = "${blockerModelName}"
local wall = Instance.new("Part")
wall.Name = "Wall"
wall.Anchored = true
wall.Size = Vector3.new(2, 40, ${String(hall.depth + 10)})
wall.Position = Vector3.new(${String(hallwayMiddleX)}, 20, ${String(hall.z)})
wall.Parent = model
model.Parent = workspace:FindFirstChild("${config.mapsFolderName}")
return "placed"`;
}

/** Proves check_map names a Model outside the map that walls off a walk, then removes that Model. */
async function probeBlockingModel(connection: StudioConnection): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  await executeLuau(connection, studioId, blockerLuau());
  try {
    const tool = createCheckMapTool(new CheckReportStore());
    const { output } = await callRealTool(tool, { mapId: smokeMapSpec.mapId }, connection);
    const blockerPath = `Workspace.${config.mapsFolderName}.${blockerModelName}`;
    expectEqual("check_map unreachable > 0 with the blocker", output.counts.unreachable > 0, true);
    expectEqual(
      "check_map warnings naming the blocker",
      output.warnings.filter((warning) => warning.startsWith(`${blockerPath} `)).length,
      1,
    );
    return output.warnings.join(" | ");
  } finally {
    await executeLuau(
      connection,
      studioId,
      `local folder = workspace:FindFirstChild("${config.mapsFolderName}")
local model = if folder then folder:FindFirstChild("${blockerModelName}") else nil
if model then model:Destroy() end
return "removed"`,
    );
  }
}

async function probeCaptureZones(connection: StudioConnection): Promise<string> {
  const { output, content } = await callRealTool(
    captureZonesTool,
    { mapId: smokeMapSpec.mapId },
    connection,
  );
  const images = content.filter((block) => block.type === "image");
  const zoneNames = smokeMapSpec.rooms.map((room) => room.name).sort();
  // The cutaway of the whole map comes first, then views a and b of the zones that fit
  // config.maxImagesPerCall; the rest come back in remainingZones.
  const fittingZones = Math.floor((config.maxImagesPerCall - 1) / 2);
  const firstZones = zoneNames.slice(0, fittingZones);
  const laterZones = zoneNames.slice(fittingZones);
  expectEqual(
    "capture_zones shots",
    output.shots.map((shot) => `${shot.zone}:${shot.view}`),
    [`${smokeMapSpec.mapId}:top`, ...firstZones.flatMap((name) => [`${name}:a`, `${name}:b`])],
  );
  expectEqual("capture_zones image count", images.length, 1 + firstZones.length * 2);
  expectEqual("capture_zones remainingZones", output.remainingZones, laterZones);
  const rest = await callRealTool(
    captureZonesTool,
    { mapId: smokeMapSpec.mapId, zones: laterZones, cutaway: false },
    connection,
  );
  expectEqual(
    "capture_zones follow-up shots",
    rest.output.shots.map((shot) => `${shot.zone}:${shot.view}`),
    laterZones.flatMap((name) => [`${name}:a`, `${name}:b`]),
  );
  expectEqual("capture_zones follow-up remainingZones", rest.output.remainingZones, []);
  // The output schema already requires a positive integer width and height per shot.
  const sizes = [...output.shots, ...rest.output.shots].map(
    (shot) => `${String(shot.width)}x${String(shot.height)}`,
  );
  const eye = await callRealTool(
    captureZonesTool,
    { mapId: smokeMapSpec.mapId, views: ["eye"], cutaway: false },
    connection,
  );
  // The eye view of each room, shot with ceilings shown.
  expectEqual(
    "capture_zones eye shots",
    eye.output.shots.map((shot) => `${shot.zone}:${shot.view}`),
    zoneNames.map((name) => `${name}:eye`),
  );
  expectEqual(
    "capture_zones eye image count",
    eye.content.filter((block) => block.type === "image").length,
    zoneNames.length,
  );
  expectEqual("capture_zones eye remainingZones", eye.output.remainingZones, []);
  return `${String(images.length)} images (cap ${String(config.maxImagesPerCall)}), the top-down cutaway then two views per zone, ${String(rest.output.shots.length)} more in a follow-up call, plus ${String(zoneNames.length)} eye views, sizes ${sizes.join(" ")}, warnings ${JSON.stringify(output.warnings)}`;
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

/** Proves the lighting rule: build A (already built), build B, remove A, remove B ends on the original lighting. */
async function probeRemoveMapLighting(
  connection: StudioConnection,
  lightingBefore: z.output<typeof lightingStateSchema>,
): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  const readLighting = async () =>
    lightingStateSchema.parse(
      JSON.parse(await executeLuau(connection, studioId, lightingStateLuau)),
    );
  const styled = await readLighting();
  if (JSON.stringify(styled) === JSON.stringify(lightingBefore)) {
    throw new Error("The styled build left Lighting unchanged, so the rule cannot be told apart.");
  }
  await callRealTool(buildMapTool, secondSmokeSpec, connection);
  const { output: removedFirst } = await callRealTool(
    removeMapTool,
    { mapId: smokeMapSpec.mapId },
    connection,
  );
  expectEqual("remove_map A restored", removedFirst.lighting.restored, null);
  expectEqual("remove_map A remaining styled maps", removedFirst.lighting.remainingStyledMaps, [
    secondSmokeSpec.mapId,
  ]);
  expectEqual("remove_map A warnings", removedFirst.warnings.length, 1);
  expectEqual("Lighting after removing A", await readLighting(), styled);
  const { output: removedSecond } = await callRealTool(
    removeMapTool,
    { mapId: secondSmokeSpec.mapId },
    connection,
  );
  expectEqual("remove_map B restored", removedSecond.lighting.restored, "original");
  expectEqual("remove_map B remaining styled maps", removedSecond.lighting.remainingStyledMaps, []);
  expectEqual("Lighting after removing B", await readLighting(), lightingBefore);
  return "lighting held while B remained and returned to the original after B";
}

/** Name of the step that builds the smoke map every later step uses; `--only` always keeps it. */
const buildStepName = "build_map";

/** The steps `--only` names plus the build step, or every step without `--only`; a term naming no step fails. */
function selectSteps(steps: [string, () => Promise<string>][]): [string, () => Promise<string>][] {
  if (onlyTerms === undefined) {
    return steps;
  }
  const unmatched = onlyTerms.filter((term) => !steps.some(([name]) => name.includes(term)));
  if (unmatched.length > 0) {
    throw new Error(`--only matches no smoke step: ${unmatched.join(", ")}`);
  }
  return steps.filter(
    ([name]) => name === buildStepName || onlyTerms.some((term) => name.includes(term)),
  );
}

/** Builds the smoke map, drives the tools against it and always removes what it inserted. */
async function probeMapTools(connection: StudioConnection): Promise<Capability[]> {
  const studioId = await selectStudio(connection, undefined);
  const findings: Capability[] = [];
  await executeLuau(connection, studioId, cleanupLuau);
  const lightingBefore = lightingStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, lightingStateLuau)),
  );
  const stateBefore = placeStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, placeStateLuau)),
  );
  try {
    const steps: [string, () => Promise<string>][] = [
      [buildStepName, () => probeBuildMap(connection)],
      ["build_map palette colors and MaterialVariant", () => probePaintedMap(connection)],
      ["build_map ceilings, generators and generated props", () => probeMapDecor(connection)],
      ["build_map lights and lighting recipe", () => probeLighting(connection)],
      ["check_map", () => probeCheckMap(connection)],
      ["check_map names a model blocking a walk", () => probeBlockingModel(connection)],
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
    ];
    if (smokeOptions.multiplayer === true) {
      steps.push([
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
      ]);
    }
    // Last: it removes the smoke map, which the steps above use.
    steps.push([
      "remove_map keeps lighting until the last styled map goes",
      () => probeRemoveMapLighting(connection, lightingBefore),
    ]);
    for (const [capability, attempt] of selectSteps(steps)) {
      findings.push(await probeTool(capability, attempt));
    }
  } finally {
    await executeLuau(connection, studioId, cleanupLuau);
  }
  const state = placeStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, placeStateLuau)),
  );
  const lightingAfter = lightingStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, lightingStateLuau)),
  );
  findings.push(
    await probeTool("place restored after the smoke", () => {
      expectEqual("Lighting", lightingAfter, lightingBefore);
      expectEqual("Workspace children", state.workspace, stateBefore.workspace);
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
  await awaitEditMode(connection);
  await assertViewportVisible(connection);
  const capabilities = [
    ...(onlyTerms === undefined ? await probeCapabilities(connection) : []),
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
