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

/** A base64 PNG header (signature and IHDR) of the given size; the test never decodes pixels. */
function pngHeader(width: number, height: number): string {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header.toString("base64");
}

/** A base64 JPEG header (SOI, one APP0 segment, then a baseline start-of-frame) of the given size. */
function jpegHeader(width: number, height: number): string {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const frame = Buffer.alloc(11);
  frame.set([0xff, 0xc0, 0x00, 0x11, 0x08]);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([soi, app0, frame]).toString("base64");
}

/** Studio's viewport size in P6; inside the long-edge range. */
const viewportImage = pngHeader(1456, 1030);

const okImage = (data: string = viewportImage): CallToolResult => ({
  content: [{ type: "image", data, mimeType: "image/png" }],
});

const ceilingsChanged = (changed: number): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ changed }) }],
});

/** The arguments of a set-ceilings-hidden call carry `hidden`; a zones read carries none. */
const isCeilingsCall = (request: { arguments: Record<string, unknown> }) =>
  String(request.arguments["code"]).includes('"hidden":');

function studioWith(captures: (captureId: string) => CallToolResult, zonesText = mapZones()) {
  return new FakeStudioConnection(studios, {
    execute_luau: (request) =>
      isCeilingsCall(request)
        ? ceilingsChanged(2)
        : { content: [{ type: "text", text: zonesText }] },
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

await test("the top-down cutaway comes first, then views a and b of each zone, each with its computed camera as an image block", async () => {
  const studio = studioWith(() => okImage());
  const result = await run(studio, { mapId: "arena" });

  const luauRequests = studio.requests.filter((request) => request.name === "execute_luau");
  const readRequest = luauRequests.find((request) => !isCeilingsCall(request));
  const captureRequests = studio.requests.filter((request) => request.name === "screen_capture");
  assert.equal(readRequest?.name, "execute_luau");
  assert.equal(readRequest.arguments["datamodel_type"], "Edit");
  const code = String(readRequest.arguments["code"]);
  assert.ok(code.includes('"mapId":"arena"'));
  assert.ok(code.includes(`"mapsFolderName":"${config.mapsFolderName}"`));

  assert.equal(captureRequests.length, 5);
  const structured = captureZonesTool.outputSchema.parse(result.structuredContent);
  assert.deepEqual(
    structured.shots.map((shot) => [shot.zone, shot.view]),
    [
      ["arena", "top"],
      ["start", "a"],
      ["start", "b"],
      ["vault", "a"],
      ["vault", "b"],
    ],
  );
  assert.deepEqual(
    captureRequests.map((request) => request.arguments["capture_id"]),
    [
      "roblox-kit-arena-arena-top",
      "roblox-kit-arena-start-a",
      "roblox-kit-arena-start-b",
      "roblox-kit-arena-vault-a",
      "roblox-kit-arena-vault-b",
    ],
  );
  assert.deepEqual(
    structured.shots[0]?.lookAt,
    [30, 6, 20],
    "the cutaway centers on the whole map",
  );
  assert.deepEqual(structured.shots[1]?.lookAt, [20, 6, 20]);
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
    Array.from({ length: 5 }, () => viewportImage),
  );
});

await test("each shot reports its image size and an in-range size adds no warning", async () => {
  const studio = studioWith((captureId) =>
    okImage(captureId.endsWith("vault-a") ? pngHeader(1568, 900) : viewportImage),
  );
  const structured = captureZonesTool.outputSchema.parse(
    (await run(studio, { mapId: "arena" })).structuredContent,
  );
  assert.deepEqual(
    structured.shots.map(({ zone, view, width, height }) => ({ zone, view, width, height })),
    [
      { zone: "arena", view: "top", width: 1456, height: 1030 },
      { zone: "start", view: "a", width: 1456, height: 1030 },
      { zone: "start", view: "b", width: 1456, height: 1030 },
      { zone: "vault", view: "a", width: 1568, height: 900 },
      { zone: "vault", view: "b", width: 1456, height: 1030 },
    ],
  );
  assert.deepEqual(structured.warnings, []);
  assert.deepEqual(structured.remainingZones, []);
});

await test("a JPEG capture reports its size from the start-of-frame segment", async () => {
  const studio = studioWith(() => ({
    content: [{ type: "image", data: jpegHeader(1456, 1030), mimeType: "image/jpeg" }],
  }));
  const structured = captureZonesTool.outputSchema.parse(
    (await run(studio, { mapId: "arena" })).structuredContent,
  );
  assert.deepEqual(
    structured.shots.map(({ width, height }) => [width, height]),
    Array.from({ length: 5 }, () => [1456, 1030]),
  );
  assert.deepEqual(structured.warnings, []);
});

await test("an image whose long edge is outside the range adds one warning naming the zone and size", async () => {
  const tooSmall = pngHeader(config.imageLongEdgeMin - 1, 500);
  const tooLarge = pngHeader(700, config.imageLongEdgeMax + 1);
  const studio = studioWith((captureId) =>
    okImage(captureId.includes("-vault-") ? tooLarge : tooSmall),
  );
  const structured = captureZonesTool.outputSchema.parse(
    (await run(studio, { mapId: "arena" })).structuredContent,
  );
  assert.equal(structured.warnings.length, 5);
  assert.match(structured.warnings[0] ?? "", /zone "arena" view top.*999x500/);
  assert.match(structured.warnings[1] ?? "", /zone "start" view a.*999x500/);
  assert.match(structured.warnings[3] ?? "", /zone "vault" view a.*700x1569/);
  assert.match(structured.warnings[4] ?? "", /zone "vault" view b.*700x1569/);
});

await test("an image that is neither a readable PNG nor a JPEG fails after the ceilings are restored", async () => {
  const studio = studioWith(() => okImage("not-a-png"));
  await assert.rejects(
    run(studio, { mapId: "arena" }),
    /zone "arena" view top.*neither a readable PNG nor a readable JPEG/,
  );
  assert.deepEqual(callKinds(studio), [
    "restore",
    "read",
    "hide",
    ...Array.from({ length: 5 }, () => "capture"),
    "restore",
  ]);
});

await test("a zone whose two views do not fit config.maxImagesPerCall is not captured and comes back in remainingZones", async () => {
  const names = Array.from(
    { length: config.maxImagesPerCall + 2 },
    (_, index) => `room-${String(index)}`,
  );
  const zones = names.map((name, index) => ({
    name,
    min: vector(index * 20, 0, 0),
    max: vector(index * 20 + 20, 12, 20),
  }));
  const studio = studioWith(() => okImage(), JSON.stringify({ zones }));
  const result = await run(studio, { mapId: "arena" });
  const structured = captureZonesTool.outputSchema.parse(result.structuredContent);
  const capturedZones = Math.floor((config.maxImagesPerCall - 1) / 2);
  const imageCount = 1 + capturedZones * 2;
  assert.ok(imageCount <= config.maxImagesPerCall);
  assert.equal(structured.shots.length, imageCount);
  assert.deepEqual(structured.shots[0]?.view, "top");
  assert.deepEqual(structured.remainingZones, names.slice(capturedZones));
  assert.equal(result.content.length, imageCount + 1);
  const captures = studio.requests.filter((request) => request.name === "screen_capture");
  assert.equal(captures.length, imageCount);
});

await test("zones limits the shots and an unknown zone lists the real ones", async () => {
  const studio = studioWith(() => okImage());
  const result = await run(studio, { mapId: "arena", zones: ["vault"] });
  const structured = captureZonesTool.outputSchema.parse(result.structuredContent);
  assert.deepEqual(
    structured.shots.map((shot) => [shot.zone, shot.view]),
    [
      ["arena", "top"],
      ["vault", "a"],
      ["vault", "b"],
    ],
  );
  assert.equal(result.content.length, 4);

  await assert.rejects(
    run(studio, { mapId: "arena", zones: ["attic"] }),
    /"attic".*Zones: start, vault/,
  );
});

await test("a map with no zones, a missing map or a capture without an image fails with an actionable message", async () => {
  await assert.rejects(
    run(
      studioWith(() => okImage(), JSON.stringify({ zones: [] })),
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
    /zone "arena" view top returned no image: viewport closed/,
  );
});

/** Every call in order, as "restore", "hide", "capture" or "read". */
function callKinds(studio: FakeStudioConnection): string[] {
  return studio.requests.map((request) => {
    if (request.name === "screen_capture") {
      return "capture";
    }
    if (!isCeilingsCall(request)) {
      return "read";
    }
    return String(request.arguments["code"]).includes('"hidden":true') ? "hide" : "restore";
  });
}

await test("ceilings are restored at call start, hidden for the captures and restored after them", async () => {
  const studio = studioWith(() => okImage());
  await run(studio, { mapId: "arena" });
  assert.deepEqual(callKinds(studio), [
    "restore",
    "read",
    "hide",
    ...Array.from({ length: 5 }, () => "capture"),
    "restore",
  ]);

  const hideCode = String(studio.requests[2]?.arguments["code"]);
  assert.ok(hideCode.includes(`"ceilingTag":"${config.ceilingTag}"`));
  assert.ok(
    hideCode.includes(
      `"originalTransparencyAttribute":"${config.ceilingOriginalTransparencyAttribute}"`,
    ),
  );
});

await test("ceilings are restored when a capture fails", async () => {
  const studio = studioWith(() => ({
    content: [{ type: "text", text: "viewport closed" }],
    isError: true,
  }));
  await assert.rejects(run(studio, { mapId: "arena" }), /returned no image/);
  assert.deepEqual(callKinds(studio), ["restore", "read", "hide", "capture", "restore"]);
});

await test("a bad zone name fails before any ceiling is hidden", async () => {
  const studio = studioWith(() => okImage());
  await assert.rejects(run(studio, { mapId: "arena", zones: ["attic"] }), /"attic"/);
  assert.deepEqual(callKinds(studio), ["restore", "read"]);
});
