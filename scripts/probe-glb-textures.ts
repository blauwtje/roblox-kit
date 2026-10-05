import { crc32, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.ts";
import { lookUpOpenCloudCredentials } from "../src/hero-props/open-cloud-credentials.ts";
import { uploadGlb } from "../src/hero-props/open-cloud-upload.ts";
import { awaitEditMode } from "../src/studio/await-edit-mode.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";
import { acquireStudioLock } from "../src/studio/studio-lock.ts";
import { executeLuau } from "./studio-insert.ts";

/**
 * `node scripts/probe-glb-textures.ts` answers X2: does an Open Cloud GLB upload keep embedded PBR textures?
 * It uploads one cube GLB with procedurally made color, normal and metallic-roughness images, loads the
 * uploaded model into the open place with InsertService and prints which SurfaceAppearance maps its MeshParts
 * carry, then `RESULT: yes` (all four maps) or `RESULT: no`. It exits 1 on a missing key, an upload failure or
 * a model that does not load. The upload stays on the account: Open Cloud has no delete call.
 */

const textureSize = 64;

function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** An RGB PNG of `textureSize` squared pixels, each from `pixel(x, y)`. */
function makePng(pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const rowLength = 1 + textureSize * 3;
  const raw = Buffer.alloc(rowLength * textureSize);
  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      raw.set(pixel(x, y), y * rowLength + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(textureSize, 0);
  header.writeUInt32BE(textureSize, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

const checker = (x: number, y: number): boolean =>
  (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;

const images = [
  // color: red and white checker
  makePng((x, y) => (checker(x, y) ? [200, 40, 40] : [240, 240, 240])),
  // normal: flat blue with a tilt on the checker's dark squares
  makePng((x, y) => (checker(x, y) ? [128, 128, 255] : [170, 128, 230])),
  // metallic-roughness: green = roughness, blue = metalness
  makePng((x, y) => (checker(x, y) ? [0, 90, 255] : [0, 230, 0])),
];

/** A unit cube: 24 vertices (4 per face) with normals and UVs, 36 indices. */
function cubeGeometry(): {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
} {
  const faces: {
    normal: [number, number, number];
    u: [number, number, number];
    v: [number, number, number];
  }[] = [
    { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const [faceIndex, face] of faces.entries()) {
    for (const [s, t] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      for (const [axis, normalComponent] of face.normal.entries()) {
        const [uComponent, vComponent] = [face.u[axis] ?? 0, face.v[axis] ?? 0];
        positions.push(0.5 * (normalComponent + s * uComponent + t * vComponent));
      }
      normals.push(...face.normal);
      uvs.push((s + 1) / 2, 1 - (t + 1) / 2);
    }
    const base = faceIndex * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, uvs, indices };
}

function padded(buffer: Buffer, fill: number): Buffer {
  const remainder = buffer.length % 4;
  return remainder === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
}

function makeGlb(): Uint8Array<ArrayBuffer> {
  const geometry = cubeGeometry();
  const views: Buffer[] = [
    Buffer.from(new Float32Array(geometry.positions).buffer),
    Buffer.from(new Float32Array(geometry.normals).buffer),
    Buffer.from(new Float32Array(geometry.uvs).buffer),
    Buffer.from(new Uint16Array(geometry.indices).buffer),
    ...images,
  ];
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number; target?: number }[] =
    [];
  let offset = 0;
  for (const [index, view] of views.entries()) {
    const target = index < 3 ? 34962 : index === 3 ? 34963 : undefined;
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: view.length,
      ...(target && { target }),
    });
    offset += padded(view, 0).length;
  }
  const gltf = {
    asset: { version: "2.0", generator: "roblox-kit probe-glb-textures" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "ProbeCube" }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 },
        ],
      },
    ],
    materials: [
      {
        name: "ProbePbr",
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicRoughnessTexture: { index: 2 },
        },
        normalTexture: { index: 1 },
      },
    ],
    textures: [0, 1, 2].map((source) => ({ source })),
    images: [4, 5, 6].map((bufferView) => ({ bufferView, mimeType: "image/png" })),
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 24,
        type: "VEC3",
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 24, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const json = padded(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
  const binary = Buffer.concat(views.map((view) => padded(view, 0)));
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8);
  const chunkHeader = (length: number, type: string): Buffer => {
    const chunk = Buffer.alloc(8);
    chunk.writeUInt32LE(length, 0);
    chunk.write(type, 4, "ascii");
    return chunk;
  };
  const glb = Buffer.concat([
    header,
    chunkHeader(json.length, "JSON"),
    json,
    chunkHeader(binary.length, "BIN\0"),
    binary,
  ]);
  return new Uint8Array(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length));
}

function inspectLuau(assetId: string): string {
  return `
local InsertService = game:GetService("InsertService")
local ok, loaded = pcall(function()
  return InsertService:LoadAsset(${assetId})
end)
if not ok then
  return game:GetService("HttpService"):JSONEncode({ loaded = false, error = tostring(loaded) })
end
local meshParts = {}
for _, descendant in loaded:GetDescendants() do
  if descendant:IsA("MeshPart") then
    local appearance = descendant:FindFirstChildOfClass("SurfaceAppearance")
    local entry = { name = descendant.Name, textureId = descendant.TextureID, surfaceAppearance = appearance ~= nil }
    if appearance then
      entry.colorMap = appearance.ColorMap
      entry.normalMap = appearance.NormalMap
      entry.roughnessMap = appearance.RoughnessMap
      entry.metalnessMap = appearance.MetalnessMap
    end
    table.insert(meshParts, entry)
  end
end
loaded:Destroy()
return game:GetService("HttpService"):JSONEncode({ loaded = true, meshParts = meshParts })
`;
}

interface MeshPartReport {
  name: string;
  textureId: string;
  surfaceAppearance: boolean;
  colorMap?: string;
  normalMap?: string;
  roughnessMap?: string;
  metalnessMap?: string;
}

const lookup = await lookUpOpenCloudCredentials();
if ("missing" in lookup) {
  console.error(`Cannot upload: ${lookup.missing}`);
  process.exit(1);
}

const releaseStudioLock = await acquireStudioLock({
  lockFile: fileURLToPath(new URL(`../${config.studioLockFile}`, import.meta.url)),
});
const connection = new StudioMcpClient({
  clientInfo: { name: `${config.serverName}-probe-glb-textures`, version: config.serverVersion },
  timeoutMs: config.upstreamTimeoutMs,
});
try {
  const glb = makeGlb();
  console.log(`GLB: ${String(glb.length)} bytes, ${String(images.length)} embedded PNG images`);
  const assetId = await uploadGlb(glb, "roblox-kit-probe-glb-textures", lookup.credentials);
  console.log(`uploaded asset ${assetId}`);
  const studioId = await awaitEditMode(connection);
  const report = JSON.parse(await executeLuau(connection, studioId, inspectLuau(assetId))) as {
    loaded: boolean;
    error?: string;
    meshParts?: MeshPartReport[];
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.loaded) throw new Error(`LoadAsset failed: ${report.error ?? "unknown"}`);
  const meshParts = report.meshParts ?? [];
  const hasFourMaps = meshParts.some(
    (part) =>
      part.surfaceAppearance &&
      [part.colorMap, part.normalMap, part.roughnessMap, part.metalnessMap].every(
        (map) => map !== undefined && map !== "",
      ),
  );
  console.log(`RESULT: ${hasFourMaps ? "yes" : "no"}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
  await releaseStudioLock();
}
