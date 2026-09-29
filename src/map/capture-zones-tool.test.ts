import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { config } from "../config.ts";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { captureZonesTool } from "./capture-zones-tool.ts";

const studios = [{ id: "studio-a", name: "Place A" }];
const vector = (x: number, y: number, z: number) => ({ x, y, z });

function mapZones(): string {
  return JSON.stringify({
    zones: [
      { name: "start", min: vector(0, 0, 0), max: vector(40, 12, 40) },
      { name: "vault", min: vector(40, 0, 0), max: vector(60, 12, 40) },
    ],
  });
}

const okImage = (data: string): CallToolResult => ({
  content: [{ type: "image", data, mimeType: "image/png" }],
});

function studioWith(captures: (captureId: string) => CallToolResult, zonesText = mapZones()) {
  return new FakeStudioConnection(studios, {
    execute_luau: () => ({ content: [{ type: "text", text: zonesText }] }),
    screen_capture: (request) => captures(String(request.arguments["capture_id"])),
  });
}

function run(studio: FakeStudioConnection, input: object) {
  return captureZonesTool.handler(captureZonesTool.inputSchema.parse(input), { studio });
}

await test("capture_zones has a strict schema, read-only annotations and the mapId lifetime in its description", () => {
  assert.equal(captureZonesTool.annotations.readOnlyHint, true);
  assert.match(captureZonesTool.description, /handle lasts while that Model exists/);
  assert.throws(() => captureZonesTool.inputSchema.parse({ mapId: "arena", extra: 1 }));
  assert.throws(() => captureZonesTool.inputSchema.parse({}));
  assert.throws(() => captureZonesTool.inputSchema.parse({ mapId: "arena", zones: [] }));
});

await test("each zone is captured with its computed camera and returned as an image block", async () => {
  const studio = studioWith((captureId) => okImage(`png-of-${captureId}`));
  const result = await run(studio, { mapId: "arena" });

  const [readRequest, ...captureRequests] = studio.requests;
  assert.equal(readRequest?.name, "execute_luau");
  assert.equal(readRequest.arguments["datamodel_type"], "Edit");
  const code = String(readRequest.arguments["code"]);
  assert.ok(code.includes('"mapId":"arena"'));
  assert.ok(code.includes(`"mapsFolderName":"${config.mapsFolderName}"`));

  assert.equal(captureRequests.length, 2);
  const structured = captureZonesTool.outputSchema.parse(result.structuredContent);
  assert.deepEqual(
    structured.shots.map((shot) => shot.zone),
    ["start", "vault"],
  );
  assert.deepEqual(structured.shots[0]?.lookAt, [20, 6, 20]);
  for (const [index, request] of captureRequests.entries()) {
    assert.equal(request.name, "screen_capture");
    assert.deepEqual(request.arguments["camera_position"], structured.shots[index]?.cameraPosition);
    assert.deepEqual(request.arguments["look_at_position"], structured.shots[index]?.lookAt);
  }

  assert.equal(result.isError, undefined);
  const [text, ...images] = result.content;
  assert.deepEqual(JSON.parse(text?.type === "text" ? text.text : ""), structured);
  assert.deepEqual(
    images.map((block) => (block.type === "image" ? block.data : block.type)),
    ["png-of-roblox-kit-arena-start", "png-of-roblox-kit-arena-vault"],
  );
});

await test("zones limits the shots and an unknown zone lists the real ones", async () => {
  const studio = studioWith((captureId) => okImage(captureId));
  const result = await run(studio, { mapId: "arena", zones: ["vault"] });
  const structured = captureZonesTool.outputSchema.parse(result.structuredContent);
  assert.deepEqual(
    structured.shots.map((shot) => shot.zone),
    ["vault"],
  );
  assert.equal(result.content.length, 2);

  await assert.rejects(
    run(studio, { mapId: "arena", zones: ["attic"] }),
    /"attic".*Zones: start, vault/,
  );
});

await test("a map with no zones, a missing map or a capture without an image fails with an actionable message", async () => {
  await assert.rejects(
    run(
      studioWith(() => okImage("x"), JSON.stringify({ zones: [] })),
      { mapId: "arena" },
    ),
    /no zones.*build_map/,
  );

  const missing = new FakeStudioConnection(studios, {
    execute_luau: () => ({
      content: [{ type: "text", text: 'No map "arena". Call build_map with this mapId first.' }],
      isError: true,
    }),
  });
  await assert.rejects(run(missing, { mapId: "arena" }), /Call build_map/);

  const noImage = studioWith(() => ({
    content: [{ type: "text", text: "viewport closed" }],
    isError: true,
  }));
  await assert.rejects(
    run(noImage, { mapId: "arena" }),
    /zone "start" returned no image: viewport closed/,
  );
});
