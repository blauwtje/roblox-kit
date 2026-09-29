import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { config } from "../config.ts";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { tools } from "../server/main.ts";
import { buildMapTool } from "./build-map-tool.ts";

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
const phaseNames = ["shell", "floors and ceilings", "openings", "surfaces", "props", "lighting"];

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

function run(studio: FakeStudioConnection, spec: object) {
  return buildMapTool.handler(buildMapTool.inputSchema.parse(spec), { studio });
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

  assert.equal(studio.requests.length, 7);
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
    min: { x: 20, y: -1, z: -20 },
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
    min: { x: 30, y: -1, z: -20 },
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
  await run(styledConnection, { ...twoRoomSpec, style: { preset: "train-station" } });
  const styledCode = String(styledConnection.requests[0]?.arguments["code"]);
  assert.ok(String(styledConnection.requests[0]?.arguments["code"]).includes('"phase":"shell"'));
  assert.ok(styledCode.includes('"color":"#8a7f70"'));
  assert.ok(styledCode.includes('"variants":{"wall":{"baseMaterial":"Brick","studsPerTile":8}}'));

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
  assert.equal(connection.requests.length, 7);
  const { lights } = requestArguments(connection, 5) as {
    lights: { zone: string; part: string; role: string; shadows: boolean }[];
  };
  assert.deepEqual(
    lights.map((light) => [light.zone, light.part, light.role, light.shadows]),
    [
      ["start", "start-floor", "hero", true],
      ["start", "start-floor", "focal", false],
      ["hall", "hall-floor", "zoneMarker", false],
    ],
  );
  assert.ok(lighting.includes('"recipe"'));
  assert.ok(lighting.includes('"mapId":"two-rooms"'));
});

await test("without a style no lights are sent and the last request only restores Lighting", async () => {
  const connection = phaseStudio();
  await run(connection, twoRoomSpec);
  assert.equal(connection.requests.length, 7);
  assert.deepEqual(requestArguments(connection, 5)["lights"], []);
  const restore = String(connection.requests[6]?.arguments["code"]);
  assert.ok(restore.includes('"mapId":"two-rooms"'));
  assert.ok(!restore.includes('"recipe"'));
});

await test("each phase request names its phase and carries only what that phase builds", async () => {
  const connection = styledStudio();
  await run(connection, { ...twoRoomSpec, style: { preset: "train-station" } });
  const sent = phaseNames.map((_, index) => requestArguments(connection, index));

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

await test("reports progress after each of the six phases", async () => {
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
    phaseNames.map((name, index) => [index + 1, 6, name]),
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
    style: { preset: "train-station" },
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
