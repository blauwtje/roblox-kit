import { z } from "zod";
import { config } from "../../src/config.ts";
import { buildMapTool, propsOf } from "../../src/map/build-map-tool.ts";
import { removeMapTool } from "../../src/map/remove-map-tool.ts";
import { placeLights } from "../../src/lighting/light-placement.ts";
import { layoutMap } from "../../src/map/map-layout.ts";
import { relationMapSpecSchema } from "../../src/map/map-spec.ts";
import { ambientEffectsOf } from "../../src/map/ambient-effects.ts";
import { solidVoxelCount, terrainChunks } from "../../src/map/terrain-heightmap.ts";
import type { PropRecord } from "../../src/map/prop-placement.ts";
import { heroPropsOf, trimMeshesOf } from "../../src/map/hero-prop-placement.ts";
import { buildFacades } from "../../src/map/facade-grammar.ts";
import { buildRoomDetails } from "../../src/map/room-details.ts";
import { resolveRelations } from "../../src/map/relation-solver.ts";
import { placeSetPieces } from "../../src/map/set-piece-placement.ts";
import { mapSpecSchema } from "../../src/map/map-spec.ts";
import { loadPresets } from "../../src/style/load-preset.ts";
import { selectStudio, type StudioConnection } from "../../src/studio/studio-connection.ts";
import { callRealTool, executeLuau, expectClose, expectEqual, presets } from "./shared.ts";

/**
 * A fixed 3-room map far from the place's Baseplate (x and z near 2000), so everything the smoke
 * builds, fills and removes lies outside what the place owns. The vault and the yard are placed by
 * relation, so the map also has two hallway zones. The hall, vault and yard take the train-station room
 * types concourse, ticket-hall and platform, so the map also has set pieces. The hall is wide enough for its
 * free-standing departure board, the vault deep enough for its ticket counter between the doorways, and the
 * yard big enough for the 40-stud train car hero prop to replace its track bed clear of the walls and the doorway.
 */
/**
 * The train-station preset paints every surface flat SmoothPlastic, which no MaterialVariant can sit on, so the
 * smoke gives the floor, wall and ceiling textured built-in materials: the wall carries a flat variant that the
 * palette step probes, and check_map finds no untextured surface.
 */
export const smokeWallVariant = {
  baseMaterial: "Brick",
  studsPerTile: 8,
};

export const smokeRelationSpec = relationMapSpecSchema.parse({
  mapId: "roblox-kit-smoke",
  style: {
    preset: "train-station",
    overrides: {
      surfaces: {
        floor: { material: "Marble" },
        wall: { material: smokeWallVariant.baseMaterial, variant: smokeWallVariant },
        ceiling: { material: "Concrete" },
      },
    },
  },
  seed: 1,
  // At the train-station size rules, so check_map with the preset reports no sizeRule issue.
  wallHeight: 16,
  doorWidth: 10,
  rooms: [
    { name: "hall", x: 2000, z: 2000, width: 60, depth: 24, spawn: true, roomType: "concourse" },
    {
      name: "vault",
      roomType: "ticket-hall",
      width: 24,
      depth: 64,
      relation: { to: "hall", direction: "east", hallwayLength: 14, hallwayWidth: 14 },
    },
    {
      name: "yard",
      roomType: "platform",
      width: 48,
      depth: 30,
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

/** The smoke map as build_map takes it with the recorded assets on: its hero props, trim meshes and baked variant maps are probed. */
export const recordedSmokeSpec = { ...smokeRelationSpec, useRecordedAssets: true };

/** A map holding only a noise heightmap, inside the smoke region and spanning four chunks; the terrain step builds and removes it. */
export const terrainSmokeSpec = relationMapSpecSchema.parse({
  mapId: "smoke-terrain",
  seed: 3,
  rooms: [{ name: "lookout", x: 2300, z: 2300, width: 20, depth: 20 }],
  // The train-station ceiling is flat SmoothPlastic, so the smoke gives it a Concrete variant for Concrete terrain to draw with.
  style: {
    preset: "train-station",
    overrides: {
      surfaces: {
        ceiling: { material: "Concrete", variant: { baseMaterial: "Concrete", studsPerTile: 8 } },
      },
      terrainVariants: { Concrete: "ceiling" },
    },
  },
  terrain: [
    {
      shape: "heightmap",
      center: { x: 2044, y: -8, z: 2030 },
      size: { x: 160, y: 24, z: 140 },
      material: "Ground",
    },
  ],
});

/** The smoke map with every room centered: what layout, lights and the checks below expect. */
export const smokeMapSpec = resolveRelations(smokeRelationSpec);

/** Studs box (min, max) around everything the smoke can touch; cleared to Air and asserted empty. */
export const smokeRegion = { min: [1960, -30, 1960], max: [2160, 30, 2100] };

/** Name of the Model the blocker probe puts beside the smoke map; the cleanup removes it by name. */
export const blockerModelName = `${smokeMapSpec.mapId}-blocker`;

/** A second styled map south of the smoke map, inside the smoke region, for the lighting rule across two maps. */
export const secondSmokeSpec = relationMapSpecSchema.parse({
  mapId: `${smokeMapSpec.mapId}-b`,
  style: { preset: "train-station" },
  seed: 1,
  wallHeight: 16,
  doorWidth: 10,
  rooms: [
    { name: "hall", x: 2000, z: 2070, width: 20, depth: 20, spawn: true, roomType: "concourse" },
  ],
});

/** One exterior shop with a door and three storeys, beside the second smoke map's place; removed by its own step. */
export const ambientSmokeSpec = relationMapSpecSchema.parse({
  mapId: "smoke-ambient",
  seed: 5,
  style: { preset: "train-station" },
  rooms: [
    { name: "concourse", x: 2500, z: 2300, width: 60, depth: 40, roomType: "concourse" },
    { name: "platform", x: 2500, z: 2400, width: 60, depth: 30, roomType: "platform" },
  ],
});

/** A styled platform, with a door sign from its concourse, whose sign and lamps the train-station preset animates; removed by its own step. */
export const idleSmokeSpec = relationMapSpecSchema.parse({
  mapId: "smoke-idle",
  seed: 7,
  style: { preset: "train-station" },
  rooms: [
    { name: "concourse", x: 2500, z: 2600, width: 60, depth: 30, doors: [{ side: "south" }] },
    {
      name: "platform",
      x: 2500,
      z: 2630,
      width: 60,
      depth: 30,
      roomType: "platform",
      doors: [{ side: "north" }],
    },
  ],
});

export const facadeSmokeSpec = relationMapSpecSchema.parse({
  mapId: `${smokeMapSpec.mapId}-facade`,
  style: { preset: "train-station" },
  seed: 1,
  wallHeight: 18,
  doorWidth: 6,
  rooms: [
    {
      name: "shop",
      x: 2000,
      z: 2070,
      width: 30,
      depth: 20,
      exterior: true,
      facadeFloors: 3,
      doors: [{ side: "south", offset: 0 }],
    },
  ],
});

/**
 * What build_map sends for the styled smoke map: layout with ceilings, trim details, preset props and the
 * hero props that replace some of them.
 */
export async function styledSmokeMap() {
  const preset = presets.get("train-station");
  if (preset === undefined) {
    throw new Error("The train-station preset is missing.");
  }
  const layout = layoutMap(smokeMapSpec, preset.surfaces, { ceilings: true });
  const details = buildRoomDetails(smokeMapSpec, layout.parts, preset.surfaces, ["floor"]);
  const {
    props,
    heroProps,
    warnings: heroWarnings,
  } = await heroPropsOf(
    smokeMapSpec,
    { name: "train-station", base: preset, style: preset },
    propsOf(smokeMapSpec, preset).props,
  );
  const trim = await trimMeshesOf(details, { base: preset, style: preset });
  return { layout, details, props, heroProps, heroWarnings, trim };
}

/** Name ending of the fixture part build_map hangs at each ceiling light. */
export const fixtureNameSuffix = "-fixture";

/** The train-station preset's lights on the smoke map, as build_map places them. */
export function smokeLightPlacements() {
  const preset = presets.get("train-station");
  if (preset === undefined) {
    throw new Error("The train-station preset is missing.");
  }
  return placeLights(smokeMapSpec, preset.lightRoles, preset.lightFixtures);
}

/** The lights without a fixture box that hang within the ceiling drop of their room's ceiling; build_map shows one cube fixture part for each. */
export function ceilingLightPlacements() {
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
export function fixtureLightPlacements() {
  return smokeLightPlacements().filter((placement) => placement.fixture !== undefined);
}

export async function probeBuildMap(connection: StudioConnection): Promise<string> {
  const { layout, details, trim } = await styledSmokeMap();
  // A trim run replaced by its profile mesh stands as a Model, which build_map's part count leaves out.
  const zonedPartCount = layout.parts.length + details.length;
  const expectedPartCount =
    zonedPartCount +
    ceilingLightPlacements().length +
    fixtureLightPlacements().length -
    trim.trimMeshes.length;
  const { output } = await callRealTool(buildMapTool, recordedSmokeSpec, connection);
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

/** Name, position and collision of every facade part of the facade smoke map. */
export const facadePartsLuau = `
local model = workspace:WaitForChild("${config.mapsFolderName}"):WaitForChild("${facadeSmokeSpec.mapId}")
local found = {}
for _, child in model:GetChildren() do
  if child:IsA("BasePart") and child.Name:find("-facade-", 1, true) then
    table.insert(found, { name = child.Name, x = child.Position.X, y = child.Position.Y, z = child.Position.Z, canCollide = child.CanCollide })
  end
end
table.sort(found, function(a, b) return a.name < b.name end)
return game:GetService("HttpService"):JSONEncode(found)`;

export const facadePartsSchema = z.array(
  z.object({
    name: z.string(),
    x: z.number(),
    y: z.number(),
    z: z.number(),
    canCollide: z.boolean(),
  }),
);

/**
 * Builds an exterior room and proves its facade parts stand in Studio exactly where the grammar puts them,
 * decorative, in every storey and clear of the doorway, then removes the map so later steps see only theirs.
 */
export async function probeFacade(connection: StudioConnection): Promise<string> {
  const preset = presets.get("train-station");
  if (preset === undefined) {
    throw new Error("The train-station preset is missing.");
  }
  const spec = resolveRelations(facadeSmokeSpec);
  const expected = buildFacades(
    spec,
    layoutMap(spec, preset.surfaces, { ceilings: true }).parts,
    preset.surfaces,
  ).sort((a, b) => (a.name < b.name ? -1 : 1));
  expectEqual("expected facade parts exist", expected.length > 0, true);
  await callRealTool(buildMapTool, facadeSmokeSpec, connection);
  const studioId = await selectStudio(connection, undefined);
  const built = facadePartsSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, facadePartsLuau)),
  );
  expectEqual(
    "facade part names",
    built.map((part) => part.name),
    expected.map((part) => part.name),
  );
  for (const [index, part] of built.entries()) {
    const planned = expected[index];
    if (planned === undefined) {
      throw new Error(`No planned facade part for ${part.name}.`);
    }
    expectClose(`${part.name} x`, part.x, planned.position.x);
    expectClose(`${part.name} y`, part.y, planned.position.y);
    expectClose(`${part.name} z`, part.z, planned.position.z);
    expectEqual(`${part.name} canCollide`, part.canCollide, false);
  }
  const paneHeights = new Set(
    built.filter((part) => part.name.includes("-pane-")).map((part) => part.y.toFixed(2)),
  );
  expectEqual("storeys with windows", paneHeights.size, 3);
  // The south door spans x 1997 to 2003 on the south wall; no south part may cover it.
  const doorMin = 2000 - 3;
  const doorMax = 2000 + 3;
  const coversDoor = expected.filter(
    (part) =>
      part.name.includes("-south-") &&
      part.position.x - part.size.x / 2 < doorMax &&
      part.position.x + part.size.x / 2 > doorMin,
  );
  expectEqual("facade parts covering the doorway", coversDoor.length, 0);
  await callRealTool(removeMapTool, { mapId: facadeSmokeSpec.mapId }, connection);
  return `${String(built.length)} facade parts built where planned, ${String(paneHeights.size)} storeys of windows`;
}

/** The ceilings, generator ModuleScripts and ProceduralModels of the built map, and every BasePart under it. */
export const mapDecorLuau = `
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

export const mapDecorSchema = z.object({
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

export async function readMapDecor(connection: StudioConnection) {
  const studioId = await selectStudio(connection, undefined);
  return mapDecorSchema.parse(JSON.parse(await executeLuau(connection, studioId, mapDecorLuau)));
}

/** Proves each prop in Studio faces its `yaw` and carries its sign's `Label` and `AccentColor`, if any. */
export function expectPropsTurnedAndLabeled(
  props: (PropRecord & { attributes?: Record<string, string> })[],
  names: string[],
  built: z.output<typeof mapDecorSchema>["proceduralModels"],
) {
  const builtByName = new Map(built.map((model) => [model.name, model]));
  for (const [index, prop] of props.entries()) {
    const name = names[index] ?? "";
    const model = builtByName.get(name);
    expectEqual(`${name} yaw`, ((model?.yaw ?? NaN) + 360) % 360, prop.yaw ?? 0);
    expectEqual(`${name} Label`, model?.label, prop.attributes?.["Label"]);
    expectEqual(
      `${name} AccentColor`,
      model?.accent,
      prop.attributes?.["AccentColor"]?.replace("#", "").toLowerCase(),
    );
  }
  expectEqual(
    "the smoke map has a sign per typed room door",
    built.some((model) => model.name.startsWith("sign-") && model.label !== undefined),
    true,
  );
}

/** Proves ceilings carry the tag, one generator per prop kind exists and every prop generated parts without error. */
export async function probeMapDecor(connection: StudioConnection): Promise<string> {
  const { layout, props, heroProps } = await styledSmokeMap();
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
    // A hero prop's replaced set piece keeps its generator, for when the asset fails to load.
    [
      ...new Set(
        [
          ...props,
          ...heroProps.flatMap((hero) => (hero.fallback === undefined ? [] : [hero.fallback])),
        ].map((prop) => `${prop.kind}-generator`),
      ),
    ].sort(),
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
  expectPropsTurnedAndLabeled(props, expectedNames, decor.proceduralModels);
  return `${String(ceilings.length)} ceilings and ${String(fixtures.length)} fixtures tagged, ${String(decor.generators.length)} generators, ${String(decor.proceduralModels.length)} props generated`;
}

/** The kind of each hero Model under the built map, sorted. */
export const heroKindsLuau = `
local model = workspace:WaitForChild("${config.mapsFolderName}"):WaitForChild("${smokeMapSpec.mapId}")
local kinds = {}
for _, child in model:GetChildren() do
  local kind = child:GetAttribute("RobloxKitHeroKind")
  if child:IsA("Model") and typeof(kind) == "string" then table.insert(kinds, kind) end
end
table.sort(kinds)
return game:GetService("HttpService"):JSONEncode(kinds)`;

/**
 * Proves every hero room holds the set piece its hero prop replaces, and that Studio loaded each hero prop
 * build_map placed. A recipe whose hash has no recorded asset keeps its set piece, as recoloring a preset leaves
 * its uploads stale and no re-upload is planned.
 */
export async function probeHeroProps(connection: StudioConnection): Promise<string> {
  const { heroProps, heroWarnings } = await styledSmokeMap();
  expectEqual(
    "hero rooms missing the set piece to replace",
    heroWarnings.filter((warning) => warning.includes(" set piece for hero prop ")),
    [],
  );
  const studioId = await selectStudio(connection, undefined);
  const built = z
    .array(z.string())
    .parse(JSON.parse(await executeLuau(connection, studioId, heroKindsLuau)));
  const heroKinds = built.filter((kind) => !kind.startsWith("trim-"));
  expectEqual("hero Models in Studio", heroKinds, heroProps.map((hero) => hero.kind).sort());
  const fallbacks = heroWarnings.filter((warning) =>
    warning.includes("has no recorded asset"),
  ).length;
  return `${String(heroKinds.length)} hero props loaded${heroKinds.length > 0 ? `: ${heroKinds.join(", ")}` : ""}, ${String(fallbacks)} kept their set piece for want of a recorded asset`;
}

/** The names of the baseboard, crown and arch boxes under the built map. */
export const trimBoxesLuau = `
local model = workspace:WaitForChild("${config.mapsFolderName}"):WaitForChild("${smokeMapSpec.mapId}")
local names = {}
for _, child in model:GetChildren() do
  if child:IsA("BasePart") and (child.Name:find("-baseboard-", 1, true) or child.Name:find("-crown-", 1, true) or child.Name:find("-arch-", 1, true)) then
    table.insert(names, child.Name)
  end
end
table.sort(names)
return game:GetService("HttpService"):JSONEncode(names)`;

/**
 * Proves each profiled trim run is its recorded mesh Model (named after the profile) and the box otherwise: the
 * boxes in Studio are exactly those no mesh replaced, and one trim Model stands per replaced box. Until the
 * profile meshes are uploaded no asset is recorded, so every run is a box.
 */
export async function probeProfileTrim(connection: StudioConnection): Promise<string> {
  const { details, trim } = await styledSmokeMap();
  const studioId = await selectStudio(connection, undefined);
  const boxes = z
    .array(z.string())
    .parse(JSON.parse(await executeLuau(connection, studioId, trimBoxesLuau)));
  const expectedBoxes = trim.details
    .filter((detail) => detail.profile !== undefined)
    .map((detail) => detail.name)
    .sort();
  expectEqual("trim boxes in Studio", boxes, expectedBoxes);
  const kinds = z
    .array(z.string())
    .parse(JSON.parse(await executeLuau(connection, studioId, heroKindsLuau)))
    .filter((kind) => kind.startsWith("trim-"));
  expectEqual("trim mesh Models in Studio", kinds, trim.trimMeshes.map((mesh) => mesh.kind).sort());
  expectEqual(
    "every profiled run is a box or a mesh",
    boxes.length + kinds.length,
    details.filter((detail) => detail.profile !== undefined).length,
  );
  return `${String(kinds.length)} profile meshes and ${String(boxes.length)} fallback boxes`;
}

/** What the built map shows in Studio: palette colors on every floor and wall, the wall variant on the walls. Pattern tiles carry their own colors and are skipped. */
export const paintedMapLuau = `
local model = workspace:WaitForChild("${config.mapsFolderName}"):WaitForChild("${smokeMapSpec.mapId}")
local variant = game:GetService("MaterialService"):FindFirstChild("${smokeMapSpec.mapId}-wall")
local painted = { floors = {}, walls = {}, wallVariants = {}, variantBase = "", variantStuds = 0, variantMaps = {}, wallVariantCount = 0 }
for _, child in game:GetService("MaterialService"):GetChildren() do
  if child.Name == "${smokeMapSpec.mapId}-wall" then painted.wallVariantCount += 1 end
end
for _, part in model:GetChildren() do
  local isTile = string.find(part.Name, "-tile-", 1, true) ~= nil
  local list = if isTile then nil elseif string.find(part.Name, "floor", 1, true) then painted.floors elseif string.find(part.Name, "wall", 1, true) then painted.walls else nil
  if list then table.insert(list, part.Color:ToHex()) end
  if list == painted.walls then table.insert(painted.wallVariants, part.MaterialVariant) end
end
if variant and variant:IsA("MaterialVariant") then
  painted.variantBase = variant.BaseMaterial.Name
  painted.variantStuds = variant.StudsPerTile
  painted.variantMaps = { color = variant.ColorMap, normal = variant.NormalMap, roughness = variant.RoughnessMap, metalness = variant.MetalnessMap }
end
return game:GetService("HttpService"):JSONEncode(painted)`;

export const paintedMapSchema = z.object({
  floors: z.array(z.string()),
  walls: z.array(z.string()),
  wallVariants: z.array(z.string()),
  wallVariantCount: z.number(),
  variantBase: z.string(),
  variantStuds: z.number(),
  variantMaps: z.object({
    color: z.string(),
    normal: z.string(),
    roughness: z.string(),
    metalness: z.string(),
  }),
});

export async function probePaintedMap(connection: StudioConnection): Promise<string> {
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
  expectEqual("one wall MaterialVariant shared by every wall", painted.wallVariantCount, 1);
  expectEqual("MaterialVariant base", painted.variantBase, smokeWallVariant.baseMaterial);
  expectEqual("MaterialVariant studsPerTile", painted.variantStuds, smokeWallVariant.studsPerTile);
  const noMaps = { color: "", normal: "", roughness: "", metalness: "" };
  expectEqual("MaterialVariant maps", painted.variantMaps, noMaps);
  return `${String(painted.floors.length)} floors and ${String(painted.walls.length)} walls painted`;
}

/** Reports the solid voxels and the materials of the heightmap's box as JSON. */
export const terrainBoxLuau = `
local min = Vector3.new(2044 - 80, -20, 2030 - 70)
local max = Vector3.new(2044 + 80, 4, 2030 + 70)
local voxels, occupancies = workspace.Terrain:ReadVoxels(Region3.new(min, max), 4)
local solid = 0
local seen = {}
local names = {}
for x = 1, voxels.Size.X do
  for y = 1, voxels.Size.Y do
    for z = 1, voxels.Size.Z do
      local material = voxels[x][y][z]
      if material ~= Enum.Material.Air then
        solid += 1
        if not seen[material] then
          seen[material] = true
          table.insert(names, material.Name)
        end
      end
    end
  end
end
table.sort(names)
local concreteOverride = game:GetService("MaterialService"):GetBaseMaterialOverride(Enum.Material.Concrete)
return game:GetService("HttpService"):JSONEncode({ solid = solid, materials = names, concreteOverride = concreteOverride })`;

export const terrainBoxSchema = z.object({
  solid: z.number(),
  materials: z.array(z.string()),
  concreteOverride: z.string(),
});

/** Builds a heightmap map, reads its voxels back against the plan, then removes it and expects empty terrain. */
export async function probeTerrainHeightmap(connection: StudioConnection): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  const fill = terrainSmokeSpec.terrain[0];
  if (fill?.shape !== "heightmap") {
    throw new Error("The terrain smoke spec has no heightmap.");
  }
  const chunks = terrainChunks(fill, terrainSmokeSpec.seed ?? config.defaultSeed);
  expectEqual("heightmap chunks", chunks.length, 4);
  await callRealTool(buildMapTool, terrainSmokeSpec, connection);
  const built = terrainBoxSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, terrainBoxLuau)),
  );
  const expected = solidVoxelCount(chunks);
  expectEqual(
    "heightmap solid voxels within 1% of the plan",
    Math.abs(built.solid - expected) <= expected / 100,
    true,
  );
  expectEqual(
    "heightmap uses the base and several surface materials",
    built.materials.length >= 3,
    true,
  );
  expectEqual("heightmap base material present", built.materials.includes("Ground"), true);
  expectEqual(
    "Concrete terrain drawn with the ceiling variant",
    built.concreteOverride,
    `${terrainSmokeSpec.mapId}-ceiling`,
  );
  await callRealTool(removeMapTool, { mapId: terrainSmokeSpec.mapId }, connection);
  const cleared = terrainBoxSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, terrainBoxLuau)),
  );
  expectEqual("heightmap voxels after remove_map", cleared.solid, 0);
  expectEqual("Concrete terrain override after remove_map", cleared.concreteOverride, "");
  return `${String(built.solid)} voxels (plan ${String(expected)}) in ${String(chunks.length)} chunks, materials ${built.materials.join(", ")}; Concrete drawn with the ceiling variant; none after remove_map`;
}

/** Reads back the ambient emitters of the ambient smoke map: per class the count and how many carry a texture. */
export const ambientCountLuau = `
local folder = workspace:FindFirstChild("${config.mapsFolderName}")
local model = folder and folder:FindFirstChild("${ambientSmokeSpec.mapId}")
local counts = { particles = 0, beams = 0, textured = 0, exists = model ~= nil }
if model then
	for _, descendant in model:GetDescendants() do
		if descendant:IsA("ParticleEmitter") then
			counts.particles += 1
		elseif descendant:IsA("Beam") then
			counts.beams += 1
		end
		if (descendant:IsA("ParticleEmitter") or descendant:IsA("Beam")) and descendant.Texture ~= "" then
			counts.textured += 1
		end
	end
end
return game:GetService("HttpService"):JSONEncode(counts)
`;

export const ambientCountSchema = z.object({
  particles: z.number().int(),
  beams: z.number().int(),
  textured: z.number().int(),
  exists: z.boolean(),
});

/** Builds the ambient smoke map, checks one emitter per planned effect and an untextured-sprite warning per missing sprite, then removes it. */
export async function probeAmbientEffects(connection: StudioConnection): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  const preset = (await loadPresets()).get("train-station");
  const effects = preset?.ambientEffects ?? [];
  const spec = resolveRelations(ambientSmokeSpec);
  const planned = ambientEffectsOf(spec, layoutMap(spec).parts, effects, {});
  const built = (
    await callRealTool(buildMapTool, { ...ambientSmokeSpec, useRecordedAssets: true }, connection)
  ).output;
  const counts = ambientCountSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, ambientCountLuau)),
  );
  const plannedBeams = planned.filter((record) => record.kind === "beam").length;
  expectEqual("ambient particle emitters", counts.particles, planned.length - plannedBeams);
  expectEqual("ambient beams", counts.beams, plannedBeams);
  expectEqual("ambient effects phase", built.phases.at(-1)?.name, "ambient effects");
  const spriteWarnings = built.warnings.filter((warning) => warning.startsWith("Ambient sprite"));
  expectEqual(
    "one warning per untextured sprite",
    spriteWarnings.length > 0,
    counts.textured < counts.particles + counts.beams,
  );
  await callRealTool(removeMapTool, { mapId: ambientSmokeSpec.mapId }, connection);
  const cleared = ambientCountSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, ambientCountLuau)),
  );
  expectEqual("ambient map after remove_map", cleared.exists, false);
  return `${String(counts.particles)} particle emitters and ${String(counts.beams)} beams as planned, ${String(counts.textured)} textured, ${String(spriteWarnings.length)} sprite warnings; none after remove_map`;
}

const twinRoomsSpec = mapSpecSchema.parse({
  mapId: "roblox-kit-smoke-twins",
  doorWidth: 6,
  rooms: ["east", "west"].map((name, index) => ({
    name,
    roomType: "ticket-hall",
    x: 2400 + index * 100,
    z: 2400,
    width: 30,
    depth: 30,
    doors: [{ side: "north", offset: -4 }],
  })),
});

/** Proves two rooms of one type get set pieces with different seeds; it needs no Studio. */
export function probeSetPieceSeeds(): string {
  const preset = presets.get("train-station");
  if (preset === undefined) {
    throw new Error("The train-station preset is missing.");
  }
  const { pieces } = placeSetPieces(
    twinRoomsSpec,
    preset.roomTypes,
    preset.palette.accent,
    smokeMapSpec.seed ?? 1,
  );
  const seeds = pieces.filter((piece) => piece.kind === "counter").map((piece) => piece.seed);
  expectEqual("counter set pieces in two same-type rooms", seeds.length, 2);
  expectEqual("the two counters share a seed", seeds[0] === seeds[1], false);
  return `two ticket-hall counters got seeds ${seeds.join(" and ")}`;
}
