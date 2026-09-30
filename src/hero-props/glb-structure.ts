import { z } from "zod";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
/** glTF primitive mode for a triangle list, the default when a primitive names none. */
const TRIANGLES_MODE = 4;

const vectorSchema = z.tuple([z.number(), z.number(), z.number()]);

const gltfSchema = z.object({
  accessors: z
    .array(
      z.object({
        count: z.number().int().nonnegative(),
        min: vectorSchema.optional(),
        max: vectorSchema.optional(),
      }),
    )
    .default([]),
  meshes: z
    .array(
      z.object({
        name: z.string().optional(),
        primitives: z.array(
          z.object({
            attributes: z.object({ POSITION: z.number().int().optional() }),
            indices: z.number().int().optional(),
            mode: z.number().int().default(TRIANGLES_MODE),
          }),
        ),
      }),
    )
    .default([]),
  materials: z.array(z.object({ name: z.string().optional() })).default([]),
});

type Gltf = z.infer<typeof gltfSchema>;
type Accessor = Gltf["accessors"][number];

/** What a generated hero-prop GLB is checked against its recipe by. */
export interface GlbStructure {
  triangles: number;
  /** Extent of the position accessors' bounds in glTF units (Y up), as `[x, y, z]`. */
  size: [number, number, number];
  meshNames: string[];
  materialNames: string[];
}

function readJsonChunk(glb: Uint8Array): unknown {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES) {
    throw new Error("GLB is shorter than its header and first chunk header");
  }
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("GLB does not start with the glTF magic");
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    throw new Error(`GLB version ${String(view.getUint32(4, true))} is not ${String(GLB_VERSION)}`);
  }
  const jsonBytes = view.getUint32(HEADER_BYTES, true);
  if (view.getUint32(HEADER_BYTES + 4, true) !== JSON_CHUNK_TYPE) {
    throw new Error("GLB's first chunk is not the JSON chunk");
  }
  const start = HEADER_BYTES + CHUNK_HEADER_BYTES;
  if (start + jsonBytes > glb.byteLength) {
    throw new Error("GLB's JSON chunk runs past the end of the file");
  }
  const text = new TextDecoder().decode(glb.subarray(start, start + jsonBytes));
  return JSON.parse(text);
}

function accessorAt(accessors: Accessor[], index: number): Accessor {
  const accessor = accessors[index];
  if (accessor === undefined) {
    throw new Error(`GLB names accessor ${String(index)}, which does not exist`);
  }
  return accessor;
}

function trianglesOf(
  primitive: Gltf["meshes"][number]["primitives"][number],
  accessors: Accessor[],
): number {
  if (primitive.mode !== TRIANGLES_MODE) {
    throw new Error(`GLB primitive mode ${String(primitive.mode)} is not a triangle list`);
  }
  const vertexSource = primitive.indices ?? primitive.attributes.POSITION;
  if (vertexSource === undefined) {
    throw new Error("GLB primitive has neither indices nor a POSITION attribute");
  }
  return accessorAt(accessors, vertexSource).count / 3;
}

/** The union of the primitives' position bounds; node transforms are not applied, so a generator must export its meshes untransformed or this reads their local size. */
function sizeOf(gltf: Gltf): [number, number, number] {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const position = primitive.attributes.POSITION;
      if (position === undefined) continue;
      const { min, max } = accessorAt(gltf.accessors, position);
      if (min === undefined || max === undefined) {
        throw new Error(`GLB position accessor ${String(position)} has no min and max`);
      }
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = Math.min(low[axis] ?? Infinity, min[axis] ?? Infinity);
        high[axis] = Math.max(high[axis] ?? -Infinity, max[axis] ?? -Infinity);
      }
    }
  }
  if (low.some((value) => !Number.isFinite(value))) {
    throw new Error("GLB has no mesh with a position accessor");
  }
  return [
    (high[0] ?? 0) - (low[0] ?? 0),
    (high[1] ?? 0) - (low[1] ?? 0),
    (high[2] ?? 0) - (low[2] ?? 0),
  ];
}

/** Reads the triangle count, size and mesh and material names of a GLB from its JSON chunk. */
export function readGlbStructure(glb: Uint8Array): GlbStructure {
  const gltf = gltfSchema.parse(readJsonChunk(glb));
  let triangles = 0;
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      triangles += trianglesOf(primitive, gltf.accessors);
    }
  }
  return {
    triangles,
    size: sizeOf(gltf),
    meshNames: gltf.meshes.map((mesh) => mesh.name ?? ""),
    materialNames: gltf.materials.map((material) => material.name ?? ""),
  };
}
