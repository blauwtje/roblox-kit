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

/** Answers build-map.luau with a built map and apply-lighting.luau with a taken snapshot. */
function styledStudio() {
  return new FakeStudioConnection(studios, {
    execute_luau: (request) => {
      const code = String(request.arguments["code"]);
      const text = code.includes('"recipe"')
        ? '{"snapshotTaken":true}'
        : '{"partCount":14,"replaced":false}';
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

await test("sends the laid-out parts and fills to Studio and returns the map handle with bounds and zones", async () => {
  const studio = studioReturning('{"partCount":14,"replaced":false}');
  const result = await run(studio, twoRoomSpec);

  const [request] = studio.requests;
  assert.equal(request?.name, "execute_luau");
  assert.equal(request.arguments["datamodel_type"], "Edit");
  const code = String(request.arguments["code"]);
  assert.ok(code.includes(`"mapsFolderName":"${config.mapsFolderName}"`));
  assert.ok(code.includes('"mapId":"two-rooms"'));
  assert.ok(code.includes('"start-spawn"'));
  assert.ok(code.includes('"shape":"ball"'));

  assert.equal(result.isError, undefined);
  const structured = buildMapTool.outputSchema.parse(result.structuredContent);
  assert.equal(structured.mapId, "two-rooms");
  assert.equal(structured.partCount, 14);
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
  assert.ok(styledCode.includes('"color":"#8a7f70"'));
  assert.ok(styledCode.includes('"variants":{"wall":{"baseMaterial":"Brick","studsPerTile":8}}'));

  const plainStudio = studioReturning('{"partCount":14,"replaced":false}');
  await run(plainStudio, twoRoomSpec);
  const plainCode = String(plainStudio.requests[0]?.arguments["code"]);
  assert.ok(plainCode.includes('"variants":{}'));
  assert.ok(plainCode.includes('"color":"#b8b8b8"'));
});

await test("a style sends its lights per zone and applies its lighting recipe after the build", async () => {
  const connection = styledStudio();
  await run(connection, { ...twoRoomSpec, style: { preset: "train-station" } });
  const [build, lighting] = connection.requests.map((request) => String(request.arguments["code"]));
  assert.equal(connection.requests.length, 2);
  const argumentsJson = /JSONDecode\(\[=*\[(.*)\]=*\]\)/s.exec(build ?? "")?.[1];
  assert.ok(argumentsJson, "the build request carries its arguments");
  const { lights } = JSON.parse(argumentsJson) as {
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
  assert.ok(lighting?.includes('"recipe"'));
  assert.ok(lighting?.includes('"mapId":"two-rooms"'));
});

await test("without a style no lights are sent and Lighting is left alone", async () => {
  const connection = studioReturning('{"partCount":14,"replaced":false}');
  await run(connection, twoRoomSpec);
  assert.equal(connection.requests.length, 1);
  assert.ok(String(connection.requests[0]?.arguments["code"]).includes('"lights":[]'));
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
