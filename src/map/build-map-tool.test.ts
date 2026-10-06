import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { config } from "../config.ts";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { tools } from "../server/main.ts";
import { buildMapTool, buildMapToolWith, propsOf } from "./build-map-tool.ts";
import { heroRecipeHash, type HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import { mapSpecSchema } from "./map-spec.ts";
import { loadPresets } from "../style/load-preset.ts";

const studios = [{ id: "studio-a", name: "Place A" }];

const twoRoomSpec = {
  mapId: "two-rooms",
  rooms: [
    { name: "start", x: 0, z: 0, width: 40, depth: 40, spawn: true, doors: [{ side: "east" }] },
    { name: "hall", x: 40, z: 0, width: 40, depth: 40, doors: [{ side: "west" }] },
  ],
  terrain: [
    {
      shape: "block",
      center: { x: 0, y: -20, z: 0 },
      size: { x: 200, y: 20, z: 200 },
      material: "Grass",
    },
    { shape: "ball", center: { x: 150, y: 0, z: 0 }, radius: 10, material: "Water" },
  ],
};

function studioReturning(text: string, isError = false) {
  return new FakeStudioConnection(studios, {
    execute_luau: () => ({ content: [{ type: "text", text }], isError }),
  });
}

/** Answers every request as a built phase, and the apply-lighting request that follows the last. */
function phaseStudio() {
  return new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const code = String(request.arguments["code"]);
      const text = code.includes('"phase":"') ? '{"partCount":14}' : '{"snapshotTaken":false}';
      return { content: [{ type: "text", text }] };
    },
  });
}

/** The phase names in the order the tool runs them. */
const phaseNames = [
  "shell",
  "floors and ceilings",
  "openings",
  "surfaces",
  "props",
  "lighting",
  "ambient effects",
];

/** The arguments JSON of the request at `index`, which carries them inside its Luau code. */
function requestArguments(connection: FakeStudioConnection, index: number) {
  const code = String(connection.requests[index]?.arguments["code"]);
  const argumentsJson = /JSONDecode\(\[=*\[(.*)\]=*\]\)/s.exec(code)?.[1];
  assert.ok(argumentsJson, `request ${String(index)} carries its arguments`);
  return JSON.parse(argumentsJson) as Record<string, unknown>;
}

/** Answers build-map.luau with a built map and apply-lighting.luau with a taken snapshot. */
function styledStudio() {
  return new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const code = String(request.arguments["code"]);
      const text = code.includes('"phase":"')
        ? '{"partCount":14,"replaced":false}'
        : '{"snapshotTaken":true}';
      return { content: [{ type: "text", text }] };
    },
  });
}

/** Runs build_map against an empty hero asset record, so the committed uploads never change a result. */
async function run(studio: FakeStudioConnection, spec: object) {
  const tool = buildMapToolWith(await fakeHeroSources(false));
  return tool.handler(tool.inputSchema.parse(spec), { studio });
}

await test("build_map is registered with a strict schema and the mapId lifetime in its description", () => {
  assert.ok(tools.includes(buildMapTool));
  assert.match(buildMapTool.description, /mapId is the handle/);
  assert.match(buildMapTool.description, /replaces the Model/);
  assert.equal(buildMapTool.annotations.readOnlyHint, false);
  assert.throws(() => buildMapTool.inputSchema.parse({ ...twoRoomSpec, extra: 1 }));
});

await test("sends the laid-out parts and fills to Studio phase by phase and returns the map handle with bounds and zones", async () => {
  const studio = phaseStudio();
  const result = await run(studio, twoRoomSpec);

  assert.equal(studio.requests.length, 8);
  for (const request of studio.requests) {
    assert.equal(request.name, "execute_luau");
    assert.equal(request.arguments["datamodel_type"], "Edit");
  }
  const [shell, floors] = studio.requests.map((request) => String(request.arguments["code"]));
  assert.ok(shell?.includes(`"mapsFolderName":"${config.mapsFolderName}"`));
  assert.ok(shell?.includes('"mapId":"two-rooms"'));
  assert.ok(shell?.includes('"shape":"ball"'));
  assert.ok(floors?.includes('"start-spawn"'));

  assert.equal(result.isError, undefined);
  const structured = buildMapTool.outputSchema.parse(result.structuredContent);
  assert.equal(structured.mapId, "two-rooms");
  assert.equal(structured.partCount, 14);
  assert.deepEqual(
    structured.phases.map((phase) => phase.name),
    phaseNames,
  );
  assert.deepEqual(structured.bounds, {
    min: { x: -100, y: -30, z: -100 },
    max: { x: 160, y: 12, z: 100 },
  });
  assert.deepEqual(
    structured.zones.map((zone) => zone.name),
    ["start", "hall"],
  );
  assert.deepEqual(structured.zones[1]?.bounds, {
    min: { x: 20, y: config.floorLiftStuds - 1, z: -20 },
    max: { x: 60, y: 12, z: 20 },
  });
  const [text] = result.content;
  assert.equal(text?.type, "text");
  assert.deepEqual(JSON.parse(text.text), structured);
});

await test("a room placed by relation builds at its grid-snapped center with a hallway zone between", async () => {
  const relationSpec = {
    mapId: "related-rooms",
    rooms: [
      { name: "start", x: 0, z: 0, width: 40, depth: 40, spawn: true },
      {
        name: "hall",
        width: 40,
        depth: 40,
        relation: { to: "start", direction: "east", hallwayLength: 10, hallwayWidth: 8 },
      },
    ],
  };
  const studio = phaseStudio();
  const result = await run(studio, relationSpec);

  assert.equal(result.isError, undefined);
  const structured = buildMapTool.outputSchema.parse(result.structuredContent);
  assert.deepEqual(
    structured.zones.map((zone) => zone.name),
    ["start", "hall", "start-hall-hallway"],
  );
  assert.deepEqual(structured.zones[1]?.bounds, {
    min: { x: 30, y: config.floorLiftStuds - 1, z: -20 },
    max: { x: 70, y: 12, z: 20 },
  });
  assert.equal(structured.zones[2]?.bounds.min.x, 20);
  assert.equal(structured.zones[2].bounds.max.x, 30);
});

await test("a relation to an unknown room fails before Studio is asked", async () => {
  const studio = studioReturning("{}");
  const spec = {
    mapId: "lost",
    rooms: [
      {
        name: "hall",
        width: 40,
        depth: 40,
        relation: { to: "nowhere", direction: "east", hallwayLength: 10, hallwayWidth: 8 },
      },
    ],
  };
  await assert.rejects(run(studio, spec), /unknown room "nowhere"/);
  assert.equal(studio.requests.length, 0);
});

await test("a spec that cannot be laid out fails before Studio is asked", async () => {
  const studio = studioReturning("{}");
  const tinyRoom = { mapId: "tiny", rooms: [{ name: "closet", x: 0, z: 0, width: 2, depth: 2 }] };
  await assert.rejects(run(studio, tinyRoom), /Room "closet"/);
  assert.equal(studio.requests.length, 0);
});

await test("a style with overrides and a seed builds like the same spec without them", async () => {
  const styled = {
    ...twoRoomSpec,
    seed: 7,
    style: { preset: "cozy-town", overrides: { sizeRules: { minDoorwayWidth: 8 } } },
  };
  const result = await run(styledStudio(), styled);
  assert.equal(result.isError, undefined);
  assert.equal(buildMapTool.outputSchema.parse(result.structuredContent).partCount, 14);
});

await test("a style sends its palette colors and role variants; without a style, defaults and no variants", async () => {
  const styledConnection = styledStudio();
  await run(styledConnection, {
    ...twoRoomSpec,
    style: {
      preset: "train-station",
      overrides: { surfaces: { wall: { variant: { baseMaterial: "Brick", studsPerTile: 8 } } } },
    },
  });
  const styledCode = String(styledConnection.requests[0]?.arguments["code"]);
  assert.ok(String(styledConnection.requests[0]?.arguments["code"]).includes('"phase":"shell"'));
  assert.ok(styledCode.includes('"color":"#d9b86c"'));
  assert.ok(styledCode.includes('"wall":{"baseMaterial":"Brick","studsPerTile":8'));

  const plainStudio = phaseStudio();
  await run(plainStudio, twoRoomSpec);
  const plainCode = String(plainStudio.requests[0]?.arguments["code"]);
  assert.ok(plainCode.includes('"variants":{}'));
  assert.ok(plainCode.includes('"color":"#b8b8b8"'));
});

await test("a style sends its lights per zone and applies its lighting recipe after the lighting phase", async () => {
  const connection = styledStudio();
  await run(connection, { ...twoRoomSpec, style: { preset: "train-station" } });
  const lighting = String(connection.requests[6]?.arguments["code"]);
  assert.equal(connection.requests.length, 8);
  const { lights } = requestArguments(connection, 5) as {
    lights: {
      zone: string;
      part: string;
      role: string;
      shadows: boolean;
      fixture?: { pendant: boolean };
    }[];
  };
  for (const zone of ["start", "hall"]) {
    const zoneLights = lights.filter((light) => light.zone === zone);
    assert.ok(zoneLights.every((light) => light.part === `${zone}-floor`));
    assert.ok(zoneLights.every((light) => light.fixture === undefined || !light.fixture.pendant));
    assert.deepEqual(
      zoneLights.filter((light) => light.role === "hero").map((light) => light.shadows),
      [false],
    );
    assert.equal(zoneLights.filter((light) => light.role === "focal").length, 0);
    const fixtureLights = zoneLights.filter((light) => light.fixture !== undefined);
    assert.ok(fixtureLights.length > 0, `${zone} has fixtures`);
    assert.ok(fixtureLights.every((light) => light.role === "zoneMarker" && !light.shadows));
  }
  assert.ok(lighting.includes('"recipe"'));
  assert.ok(lighting.includes('"mapId":"two-rooms"'));
});

await test("the lighting phase carries what places a fixture at each ceiling light", async () => {
  const connection = styledStudio();
  await run(connection, { ...twoRoomSpec, style: { preset: "train-station" } });
  const lightingArguments = requestArguments(connection, 5);
  assert.equal(lightingArguments["ceilingTag"], config.ceilingTag);
  assert.equal(lightingArguments["ceilingDropStuds"], config.lightCeilingDropStuds);
  assert.equal(lightingArguments["fixtureSizeStuds"], config.lightFixtureSizeStuds);
});

await test("without a style no lights are sent and the request after the lighting phase only restores Lighting", async () => {
  const connection = phaseStudio();
  await run(connection, twoRoomSpec);
  assert.equal(connection.requests.length, 8);
  assert.deepEqual(requestArguments(connection, 5)["lights"], []);
  const restore = String(connection.requests[6]?.arguments["code"]);
  assert.ok(restore.includes('"mapId":"two-rooms"'));
  assert.ok(!restore.includes('"recipe"'));
});

await test("each phase request names its phase and carries only what that phase builds", async () => {
  const connection = styledStudio();
  await run(connection, { ...twoRoomSpec, style: { preset: "train-station" } });
  // The Lighting recipe request follows the lighting phase, so the ambient effects phase is one request later.
  const sent = phaseNames.map((_, index) =>
    requestArguments(connection, index < 6 ? index : index + 1),
  );
  const ambient = sent[6] as { phase: string; effects: { name: string; zone: string }[] };
  assert.equal(ambient.phase, "ambient effects");
  assert.ok(Array.isArray(ambient.effects));

  assert.deepEqual(
    sent.map((phaseArguments) => phaseArguments["phase"]),
    phaseNames,
  );
  const kindsOf = (phaseArguments: Record<string, unknown> | undefined) =>
    new Set((phaseArguments?.["parts"] as { kind: string }[]).map((part) => part.kind));
  assert.deepEqual(kindsOf(sent[0]), new Set(["wall"]));
  assert.deepEqual(kindsOf(sent[1]), new Set(["floor", "spawn", "ceiling"]));
  assert.deepEqual(kindsOf(sent[2]), new Set(["arch"]));
  assert.ok(!kindsOf(sent[3]).has("arch"));
  assert.ok(sent[0]?.["materials"]);
  assert.ok(sent[4]?.["generators"]);
});

await test("a phase failure names the phase and keeps Studio's message", async () => {
  const connection = new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const isSurfaces = String(request.arguments["code"]).includes('"phase":"surfaces"');
      return {
        content: [{ type: "text", text: isSurfaces ? "boom" : '{"partCount":1}' }],
        isError: isSurfaces,
      };
    },
  });
  await assert.rejects(
    run(connection, { ...twoRoomSpec, style: { preset: "train-station" } }),
    /failed in the "surfaces" phase.*boom/,
  );
  assert.equal(connection.requests.length, 4);
});

await test("reports progress after each of the seven phases", async () => {
  const progress: [number, number, string][] = [];
  await buildMapTool.handler(buildMapTool.inputSchema.parse(twoRoomSpec), {
    studio: phaseStudio(),
    reportProgress: (done, total, message) => {
      progress.push([done, total, message]);
      return Promise.resolve();
    },
  });
  assert.deepEqual(
    progress,
    phaseNames.map((name, index) => [index + 1, 7, name]),
  );
});

/** The layout the styled build sends, gathered from its phase requests. */
function sentBuild(connection: FakeStudioConnection) {
  const sent = phaseNames.map((_, index) => requestArguments(connection, index));
  const partsOf = (index: number) =>
    (sent[index]?.["parts"] ?? []) as { kind: string; canCollide: boolean }[];
  return {
    parts: [...partsOf(0), ...partsOf(1)],
    details: [...partsOf(2), ...partsOf(3)],
    props: (sent[4]?.["props"] ?? []) as { kind: string; seed: number }[],
    generators: (sent[4]?.["generators"] ?? {}) as Record<string, string>,
    ceilingTag: sent[1]?.["ceilingTag"],
  };
}

await test("a style sends ceilings, details, props and one generator source per prop kind", async () => {
  const connection = styledStudio();
  const result = await run(connection, {
    mapId: "two-rooms",
    seed: 3,
    style: { preset: "cozy-town" },
    rooms: [
      { name: "start", x: 0, z: 0, width: 40, depth: 40, spawn: true, doors: [{ side: "east" }] },
      { name: "hall", x: 40, z: 0, width: 40, depth: 40, doors: [{ side: "west" }] },
    ],
  });
  const sent = sentBuild(connection);

  assert.equal(sent.ceilingTag, config.ceilingTag);
  assert.equal(sent.parts.filter((part) => part.kind === "ceiling").length, 2);
  assert.ok(sent.details.length > 0);
  assert.ok(sent.details.every((detail) => !detail.canCollide));
  assert.ok(sent.props.length > 0);
  assert.ok(sent.props.every((prop) => Number.isInteger(prop.seed)));
  const kinds = [...new Set(sent.props.map((prop) => prop.kind))].sort();
  assert.deepEqual(Object.keys(sent.generators).sort(), kinds);
  for (const source of Object.values(sent.generators)) {
    assert.ok(source.length > 0);
  }

  const structured = buildMapTool.outputSchema.parse(result.structuredContent);
  const zonedParts = structured.zones.reduce((sum, zone) => sum + zone.partCount, 0);
  assert.equal(zonedParts, sent.parts.length + sent.details.length);
  const phaseSizes = [
    sent.parts.filter((part) => part.kind === "wall").length,
    sent.parts.filter((part) => part.kind !== "wall").length,
    sent.details.filter((detail) => detail.kind === "arch").length,
    sent.details.filter((detail) => detail.kind !== "arch").length,
    sent.props.length,
  ];
  assert.deepEqual(
    structured.phases.slice(0, 5).map((phase) => phase.partCount),
    phaseSizes,
  );
});

await test("without a style no ceilings, details, props or generators are sent", async () => {
  const connection = phaseStudio();
  await run(connection, twoRoomSpec);
  const sent = sentBuild(connection);

  assert.equal(sent.parts.filter((part) => part.kind === "ceiling").length, 0);
  assert.deepEqual(sent.details, []);
  assert.deepEqual(sent.props, []);
  assert.deepEqual(sent.generators, {});
});

await test("an unknown preset fails naming the known ones before Studio is asked", async () => {
  const studio = studioReturning("{}");
  await assert.rejects(
    run(studio, { ...twoRoomSpec, style: { preset: "nowhere" } }),
    /Unknown style preset "nowhere"; known presets: .*cozy-town/,
  );
  assert.equal(studio.requests.length, 0);
});

await test("a room type the style lacks fails naming the room before Studio is asked", async () => {
  const studio = studioReturning("{}");
  const typedRooms = twoRoomSpec.rooms.map((room, index) =>
    index === 0 ? { ...room, roomType: "platform" } : room,
  );
  const styled = { ...twoRoomSpec, rooms: typedRooms, style: { preset: "cozy-town" } };
  await assert.rejects(
    run(studio, styled),
    /Room "start" has room type "platform".*declared room types/,
  );
  const unstyled = { ...twoRoomSpec, rooms: typedRooms };
  await assert.rejects(run(studio, unstyled), /Room "start" has room type "platform".*none/);
  assert.equal(studio.requests.length, 0);
});

await test("a room type the style declares builds", async () => {
  const studio = phaseStudio();
  const typedRooms = twoRoomSpec.rooms.map((room, index) =>
    index === 0 ? { ...room, roomType: "platform" } : room,
  );
  const overrides = {
    roomTypes: { platform: { setPieces: ["track-bed"], signLabel: "PLATFORM 1" } },
    propRules: {
      "track-bed": {
        heightRatio: { min: 0.11, max: 0.25 },
        widthRatio: { min: 1.84, max: 4 },
        depthRatio: { min: 0.57, max: 1.25 },
        freeRotation: false,
        depth: 10,
        surface: "exempt",
      },
    },
  };
  const spec = { ...twoRoomSpec, rooms: typedRooms, style: { preset: "cozy-town", overrides } };
  await run(studio, spec);
  assert.ok(studio.requests.length > 0);
});

await test("propsOf furnishes a typed room with its arrangements after its set pieces and merges warnings", async () => {
  const preset = (await loadPresets()).get("cozy-town");
  assert.ok(preset !== undefined);
  const style = {
    ...preset,
    roomTypes: {
      platform: {
        setPieces: ["track-bed"],
        signLabel: "PLATFORM 1",
        arrangements: [
          { shape: "along-length" as const, piece: "lamp", spacing: 12, inset: 2 },
          { shape: "grid" as const, piece: "pillar", spacing: 5000 },
        ],
      },
    },
  };
  const spec = {
    ...twoRoomSpec,
    rooms: twoRoomSpec.rooms.map((room, index) =>
      index === 0 ? { ...room, roomType: "platform", width: 60, depth: 20 } : room,
    ),
  };
  const { props, warnings } = propsOf(mapSpecSchema.parse(spec), style);
  const kinds = props.map((prop) => prop.kind);
  assert.ok(kinds.includes("track-bed"));
  const afterSetPieces = kinds.slice(kinds.indexOf("track-bed") + 1);
  assert.ok(
    afterSetPieces.filter((kind) => kind === "lamp").length > 1,
    "arrangement lamps follow the set piece",
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /pillar/);
});

await test("propsOf gives every prop the preset's slot attributes, a surface role overriding frame and exempt keeping it", async () => {
  const preset = (await loadPresets()).get("cozy-town");
  assert.ok(preset !== undefined);
  const lampRule = preset.propRules["lamp"];
  const benchRule = preset.propRules["bench"];
  assert.ok(lampRule !== undefined && benchRule !== undefined);
  const style = {
    ...preset,
    propKit: ["lamp", "bench"],
    propRules: {
      ...preset.propRules,
      lamp: { ...lampRule, surface: "accent" as const },
      bench: { ...benchRule, surface: "exempt" as const },
    },
  };
  const { props } = propsOf(mapSpecSchema.parse(twoRoomSpec), style);
  const lamps = props.filter((prop) => prop.kind === "lamp");
  const benches = props.filter((prop) => prop.kind === "bench");
  assert.ok(lamps.length > 0 && benches.length > 0, "the plain rooms place both kinds");
  const slotAttributes = Object.fromEntries(
    Object.entries(style.propSlots).flatMap(([slot, look]) => {
      const name = slot.charAt(0).toUpperCase() + slot.slice(1);
      return [
        [`${name}Color`, look.color],
        [`${name}Material`, look.material],
      ];
    }),
  );
  for (const lamp of lamps) {
    assert.equal(Object.keys(lamp.attributes ?? {}).length, 14);
    assert.deepEqual(lamp.attributes, {
      ...slotAttributes,
      FrameColor: style.surfaces.accent.color,
      FrameMaterial: style.surfaces.accent.material,
    });
    assert.equal(Object.hasOwn(lamp.attributes ?? {}, "SurfaceColor"), false);
  }
  for (const bench of benches) {
    assert.deepEqual(bench.attributes, slotAttributes);
  }
});

await test("passes Studio's error text on, such as an unknown material", async () => {
  const message = "Unknown Roblox material name(s): Marbel. Use names from Enum.Material.";
  await assert.rejects(
    run(studioReturning(message, true), twoRoomSpec),
    /Unknown Roblox material name\(s\): Marbel/,
  );
});

await test("asks for a studioId when several Studios are connected", async () => {
  const studio = new FakeStudioConnection([...studios, { id: "studio-b", name: "Place B" }]);
  await assert.rejects(run(studio, twoRoomSpec), /Pass studioId as one of/);
  assert.equal(studio.requests.length, 0);
});

await test("build-map.luau is strict, guards its build with a recording and checks materials first", async () => {
  const source = await readFile(new URL("../../luau/build-map.luau", import.meta.url), "utf8");
  assert.ok(source.startsWith("--!strict"));
  assert.ok(source.includes("TryBeginRecording"));
  assert.ok(source.includes("Enum.FinishRecordingOperation.Cancel"));
  assert.ok(source.includes("MaterialService"));
  assert.ok(source.includes("Color3.fromHex"));
  assert.ok(source.includes("RobloxKitLightingSnapshot"));
  assert.ok(source.includes("PointLight"));
  assert.ok(source.indexOf("assertMaterialsExist()") < source.indexOf("TryBeginRecording"));
});

/** The train-station benchmark, whose platform lists the train-car hero prop in place of its track bed. */
const benchmarkSpec = JSON.parse(
  await readFile(new URL("../../eval/benchmarks/train-station.json", import.meta.url), "utf8"),
) as object;
const trainStation = (await loadPresets()).get("train-station");
assert.ok(trainStation !== undefined);
const trainCarHash = await heroRecipeHash(trainStation, "train-car");

/** A temporary hero-assets.json, recording the train car when `recorded`. */
async function fakeHeroSources(recorded: boolean): Promise<HeroPropSources> {
  const directory = await mkdtemp(join(tmpdir(), "build-map-heroes-"));
  const assetsFile = pathToFileURL(join(directory, "hero-assets.json"));
  const assets = recorded ? { [trainCarHash]: { kind: "train-car", assetId: "987654" } } : {};
  await writeFile(assetsFile, JSON.stringify(assets));
  return { assetsFile };
}

async function writeIfAbsent(file: URL, text: string): Promise<boolean> {
  try {
    await writeFile(file, text, { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Runs `run` with a passed review and a GLB for the train car in the folder the old uploader read, Open Cloud
 * credentials in the environment and `fetch` counted, then puts all of it back. Returns the number of fetch calls.
 */
async function countFetchesWithReviewedTrainCar(run: () => Promise<void>): Promise<number> {
  const folder = new URL(
    `../../${config.heroPropsFolder}/train-station-train-car-${trainCarHash}/`,
    import.meta.url,
  );
  const created = await mkdir(folder, { recursive: true });
  const reviewFile = new URL("review.json", folder);
  const glbFile = new URL("model.glb", folder);
  const wroteReview = await writeIfAbsent(
    reviewFile,
    JSON.stringify({ hash: trainCarHash, passed: true }),
  );
  const wroteGlb = await writeIfAbsent(glbFile, "glTF");
  const savedEnv = process.env;
  const withoutGroup = Object.entries(savedEnv).filter(
    ([name]) => name !== config.openCloudCreatorGroupIdEnv,
  );
  process.env = {
    ...Object.fromEntries(withoutGroup),
    [config.openCloudApiKeyEnv]: "test-key",
    [config.openCloudCreatorUserIdEnv]: "42",
  };
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return Promise.reject(new Error("no Open Cloud call is expected"));
  };
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
    process.env = savedEnv;
    // Only what this helper created is removed; a review already on disk is left alone.
    if (created !== undefined) await rm(created, { recursive: true, force: true });
    if (created === undefined && wroteReview) await rm(reviewFile, { force: true });
    if (created === undefined && wroteGlb) await rm(glbFile, { force: true });
  }
  return fetchCalls;
}

const propsPhaseIndex = phaseNames.indexOf("props");

/** The benchmark with recorded assets turned on, as the author's own places build it. */
const recordedBenchmarkSpec = { ...benchmarkSpec, useRecordedAssets: true };

await test("recorded assets are off by default: no hero props, trim meshes, variant maps or missing-asset warnings", async () => {
  const studio = phaseStudio();
  const tool = buildMapToolWith(await fakeHeroSources(true));
  const result = await tool.handler(tool.inputSchema.parse(benchmarkSpec), { studio });
  const propsPhase = requestArguments(studio, propsPhaseIndex);
  assert.deepEqual(propsPhase["heroProps"] ?? [], []);
  assert.deepEqual(propsPhase["trimMeshes"] ?? [], []);
  const props = propsPhase["props"] as { kind: string }[];
  assert.ok(
    props.some((prop) => prop.kind === "track-bed"),
    "the set piece stays",
  );
  const shell = String(studio.requests[0]?.arguments["code"]);
  assert.ok(!shell.includes('"maps"'), "no MaterialVariant carries baked maps");
  const structured = buildMapTool.outputSchema.parse(result.structuredContent);
  assert.deepEqual(
    structured.warnings.filter((warning) => /hero prop|Trim mesh|Ambient sprite/.test(warning)),
    [],
  );
});

await test("useRecordedAssets true keeps the variants' baked maps", async () => {
  const studio = phaseStudio();
  const tool = buildMapToolWith(await fakeHeroSources(false));
  // train-station has no MaterialVariants; horror-facility's carry baked maps.
  const spec = { ...twoRoomSpec, style: { preset: "horror-facility" }, useRecordedAssets: true };
  await tool.handler(tool.inputSchema.parse(spec), { studio });
  assert.ok(String(studio.requests[0]?.arguments["code"]).includes('"maps"'));
});

await test("useRecordedAssets is a documented boolean that defaults to false", () => {
  assert.equal(buildMapTool.inputSchema.parse(twoRoomSpec).useRecordedAssets, false);
  assert.throws(() => buildMapTool.inputSchema.parse({ ...twoRoomSpec, useRecordedAssets: "yes" }));
  assert.match(buildMapTool.description, /useRecordedAssets/);
});

await test("a recorded hero asset is sent to the props phase in the slot of the set piece it replaces", async () => {
  const studio = phaseStudio();
  const tool = buildMapToolWith(await fakeHeroSources(true));
  const result = await tool.handler(tool.inputSchema.parse(recordedBenchmarkSpec), { studio });
  const propsPhase = requestArguments(studio, propsPhaseIndex);
  const heroProps = propsPhase["heroProps"] as { kind: string; assetId: string; size: object }[];
  const trainCars = heroProps.filter((hero) => hero.kind === "train-car");
  assert.equal(trainCars.length, 1);
  const [hero] = trainCars;
  assert.ok(hero !== undefined);
  assert.equal(hero.kind, "train-car");
  assert.equal(hero.assetId, "987654");
  assert.deepEqual(hero.size, { x: 40, y: 7.8, z: 7 });
  const props = propsPhase["props"] as { kind: string }[];
  assert.ok(!props.some((prop) => prop.kind === "track-bed"), "the track bed gives up its slot");
  const record = hero as { fallback?: { kind: string } };
  assert.equal(record.fallback?.kind, "track-bed", "the hero carries the set piece it replaced");
  assert.ok(
    "track-bed" in (propsPhase["generators"] as object),
    "the fallback kind has a generator",
  );
  const structured = buildMapTool.outputSchema.parse(result.structuredContent);
  assert.ok(!structured.warnings.some((warning) => warning.includes("hero prop train-car")));
  assert.equal(structured.phases[propsPhaseIndex]?.partCount, props.length + heroProps.length);
});

await test("without a recorded hero asset the set piece stays and the result says why", async () => {
  const studio = phaseStudio();
  const tool = buildMapToolWith(await fakeHeroSources(false));
  const result = await tool.handler(tool.inputSchema.parse(recordedBenchmarkSpec), { studio });
  const propsPhase = requestArguments(studio, propsPhaseIndex);
  const heroProps = propsPhase["heroProps"] as { kind: string }[];
  assert.ok(!heroProps.some((hero) => hero.kind === "train-car"));
  const props = propsPhase["props"] as { kind: string }[];
  assert.ok(props.some((prop) => prop.kind === "track-bed"));
  const structured = buildMapTool.outputSchema.parse(result.structuredContent);
  const heroWarnings = structured.warnings.filter((warning) =>
    warning.includes("hero prop train-car"),
  );
  assert.equal(heroWarnings.length, 1);
  assert.match(
    heroWarnings[0] ?? "",
    /keeps its track-bed set piece instead of hero prop train-car/,
  );
  assert.match(heroWarnings[0] ?? "", /generate and upload it from a clone of the roblox-kit repo/);
});

await test("a reviewed but unrecorded hero prop makes no Open Cloud call and returns the clone warning", async () => {
  const studio = phaseStudio();
  const tool = buildMapToolWith(await fakeHeroSources(false));
  let result: Awaited<ReturnType<typeof tool.handler>> | undefined;
  const fetchCalls = await countFetchesWithReviewedTrainCar(async () => {
    result = await tool.handler(tool.inputSchema.parse(recordedBenchmarkSpec), { studio });
  });
  assert.equal(fetchCalls, 0, "no Open Cloud call is made");
  const structured = buildMapTool.outputSchema.parse(result?.structuredContent);
  const heroWarnings = structured.warnings.filter((warning) =>
    warning.includes("hero prop train-car"),
  );
  assert.equal(heroWarnings.length, 1);
  assert.match(heroWarnings[0] ?? "", /generate and upload it from a clone of the roblox-kit repo/);
});

await test("a hero asset that fails to load becomes a warning naming its asset id and error", async () => {
  const studio = new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const code = String(request.arguments["code"]);
      const props = code.includes('"phase":"props"');
      const text = props
        ? '{"partCount":14,"heroLoadFailures":[{"kind":"train-car","assetId":"987654","error":"HTTP 403"}]}'
        : code.includes('"phase":"')
          ? '{"partCount":14}'
          : '{"snapshotTaken":false}';
      return { content: [{ type: "text", text }] };
    },
  });
  const tool = buildMapToolWith(await fakeHeroSources(true));
  const result = await tool.handler(tool.inputSchema.parse(recordedBenchmarkSpec), { studio });
  const structured = buildMapTool.outputSchema.parse(result.structuredContent);
  const failure = structured.warnings.filter((warning) => warning.includes("failed to load"));
  assert.equal(failure.length, 1);
  assert.match(failure[0] ?? "", /train-car \(asset 987654\) failed to load: HTTP 403/);
  assert.match(failure[0] ?? "", /track-bed set piece is built instead/);
});

await test("build-map.luau loads each hero asset in pcall and builds the fallback set piece on failure", async () => {
  const source = await readFile(new URL("../../luau/build-map.luau", import.meta.url), "utf8");
  const loading = source.slice(source.indexOf("local loaded, heroOrError = pcall"));
  assert.match(loading, /pcall\(function\(\)[\s\S]*?InsertService:LoadAsset\(assetId\)/);
  assert.ok(loading.includes("addProp(model, generators, record.fallback, countByKind)"));
  assert.ok(source.includes("heroLoadFailures = heroLoadFailures"));
});

await test("build-map.luau loads each hero asset, scales it to its size and colors its MeshParts without collision", async () => {
  const source = await readFile(new URL("../../luau/build-map.luau", import.meta.url), "utf8");
  for (const fragment of [
    "InsertService:LoadAsset",
    ":ScaleTo(",
    "MeshPart",
    "surfaces[",
    "CanCollide = false",
    "CanTouch = false",
    "CanQuery = false",
    "RobloxKitHeroKind",
    "arguments.heroProps",
  ]) {
    assert.ok(source.includes(fragment), `build-map.luau has ${fragment}`);
  }
});

await test("check-map.luau's placement check covers the hero Models", async () => {
  const source = await readFile(new URL("../../luau/check-map.luau", import.meta.url), "utf8");
  const placedBox = source.slice(
    source.indexOf("local function placedBox"),
    source.indexOf("local function findPlacement"),
  );
  assert.ok(source.includes('HERO_KIND_ATTRIBUTE_NAME = "RobloxKitHeroKind"'));
  assert.ok(placedBox.includes("HERO_KIND_ATTRIBUTE_NAME") && placedBox.includes("GetBoundingBox"));
  const placement = source.slice(source.indexOf("local function findPlacement"));
  assert.ok(placement.includes("placedBox(child)"));
});

await test("a typed room gets its style's ambient effects, untextured with one warning per unrecorded sprite", async () => {
  const connection = styledStudio();
  const typedSpec = {
    ...twoRoomSpec,
    useRecordedAssets: true,
    style: { preset: "train-station" },
    rooms: twoRoomSpec.rooms.map((room) =>
      room.name === "hall" ? { ...room, roomType: "platform" } : room,
    ),
  };
  const result = await run(connection, typedSpec);
  const ambient = requestArguments(connection, 7) as {
    phase: string;
    effects: { name: string; zone: string; kind: string; texture?: string }[];
  };
  assert.equal(ambient.phase, "ambient effects");
  assert.deepEqual(
    ambient.effects.map((effect) => `${effect.zone}:${effect.name}`),
    ["hall:steam", "hall:sparks"],
  );
  assert.ok(ambient.effects.every((effect) => effect.texture === undefined));
  const warnings = (result.structuredContent as { warnings: string[] }).warnings.filter((warning) =>
    warning.startsWith("Ambient sprite"),
  );
  assert.equal(warnings.length, 2);
  assert.match(warnings[0] ?? "", /"steam".*untextured/);
});

await test("the props phase carries the style's idle animations of placed kinds and the idle Script, and an unstyled map none", async () => {
  const connection = styledStudio();
  const typedSpec = {
    ...twoRoomSpec,
    style: { preset: "train-station" },
    rooms: twoRoomSpec.rooms.map((room) =>
      room.name === "hall" ? { ...room, roomType: "platform" } : room,
    ),
  };
  await run(connection, typedSpec);
  const props = requestArguments(connection, 4) as {
    phase: string;
    props: { kind: string }[];
    idleAnimations?: Record<string, { swayDegrees: number; periodSeconds: number; hinge: string }>;
    idleScript?: string;
  };
  assert.equal(props.phase, "props");
  const placedKinds = new Set(props.props.map((prop) => prop.kind));
  assert.deepEqual(Object.keys(props.idleAnimations ?? {}).sort(), ["lamp", "sign"]);
  assert.ok(Object.keys(props.idleAnimations ?? {}).every((kind) => placedKinds.has(kind)));
  const hinges = Object.entries(props.idleAnimations ?? {}).map(
    ([kind, idle]) => `${kind}:${idle.hinge}`,
  );
  assert.deepEqual(hinges.sort(), ["lamp:bottom", "sign:top"]);
  assert.match(props.idleScript ?? "", /IdleSwayDegrees/);
  assert.match(props.idleScript ?? "", /Heartbeat/);

  const plain = phaseStudio();
  await run(plain, twoRoomSpec);
  const plainProps = requestArguments(plain, 4);
  assert.equal(plainProps["phase"], "props");
  assert.equal(plainProps["idleAnimations"], undefined);
  assert.equal(plainProps["idleScript"], undefined);
});

await test("build-map.luau sets the idle attributes on animated props and adds the server Script", async () => {
  const source = await readFile(new URL("../../luau/build-map.luau", import.meta.url), "utf8");
  for (const fragment of [
    "IdleSwayDegrees",
    "IdlePeriodSeconds",
    "IdleHinge",
    "Enum.RunContext.Server",
    "arguments.idleScript",
  ]) {
    assert.ok(source.includes(fragment), `build-map.luau has ${fragment}`);
  }
});

await test("lookIssues is empty without a style", async () => {
  const result = await run(phaseStudio(), twoRoomSpec);
  const structured = buildMapTool.outputSchema.parse(result.structuredContent);
  assert.deepEqual(structured.lookIssues, []);
});

await test("lookIssues reports narrow doorways with a patch and palette findings, and the build still succeeds", async () => {
  const studio = phaseStudio();
  const narrowRooms = twoRoomSpec.rooms.map((room) => ({ ...room, doorWidth: 4 }));
  const result = await run(studio, {
    ...twoRoomSpec,
    rooms: narrowRooms,
    style: {
      preset: "cozy-town",
      overrides: { surfaces: { wall: { color: "#ff00ff" }, ceiling: { color: "#ff00ff" } } },
    },
  });
  assert.equal(result.isError, undefined);
  assert.equal(studio.requests.length, 8);
  const { lookIssues } = buildMapTool.outputSchema.parse(result.structuredContent);
  const doorway = lookIssues.find((issue) => issue.kind === "doorway");
  assert.ok(doorway?.suggestedSpecPatch, "a doorway issue carries a patch");
  assert.ok(lookIssues.some((issue) => issue.kind === "palette"));
  assert.ok(lookIssues.some((issue) => issue.kind === "value"));
});
