import { z } from "zod";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
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
        bufferView: z.number().int().optional(),
        byteOffset: z.number().int().nonnegative().default(0),
        componentType: z.number().int().optional(),
        type: z.string().optional(),
        min: vectorSchema.optional(),
        max: vectorSchema.optional(),
      }),
    )
    .default([]),
  bufferViews: z
    .array(
      z.object({
        byteOffset: z.number().int().nonnegative().default(0),
        byteLength: z.number().int().nonnegative(),
        byteStride: z.number().int().positive().optional(),
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

/** The parsed JSON chunk and, when the file has one, the BIN chunk's bytes. */
function readChunks(glb: Uint8Array): { json: unknown; bin: Uint8Array | undefined } {
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
  const json: unknown = JSON.parse(text);
  const binHeader = start + jsonBytes;
  if (binHeader + CHUNK_HEADER_BYTES > glb.byteLength) return { json, bin: undefined };
  const binBytes = view.getUint32(binHeader, true);
  if (view.getUint32(binHeader + 4, true) !== BIN_CHUNK_TYPE) return { json, bin: undefined };
  const binStart = binHeader + CHUNK_HEADER_BYTES;
  if (binStart + binBytes > glb.byteLength) {
    throw new Error("GLB's BIN chunk runs past the end of the file");
  }
  return { json, bin: glb.subarray(binStart, binStart + binBytes) };
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
  const gltf = gltfSchema.parse(readChunks(glb).json);
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

type Vector = [number, number, number];

/** Byte sizes of the component types an index accessor may use; positions are always 4-byte floats. */
const indexComponentBytes = new Map([
  [5121, 1],
  [5123, 2],
  [5125, 4],
]);
const FLOAT_COMPONENT = 5126;
/** Positions are welded on a grid this many steps per stud, since a flat-shaded export splits every vertex. */
const WELD_STEPS_PER_STUD = 1e4;
/** A closed part whose signed volume is below minus this many cubic studs counts as inside out. */
const INVERTED_VOLUME_EPSILON = 1e-9;

/** One connected piece of a mesh: its bounds, whether every edge is shared by an even number of triangles, and its signed volume. */
export interface GlbPart {
  mesh: string;
  min: Vector;
  max: Vector;
  closed: boolean;
  signedVolume: number;
}

/** The deterministic checks of a generated GLB that gate its upload; parts are named `<mesh>#<n>`. */
export interface GlbChecks {
  passed: boolean;
  parts: number;
  /** Parts that touch neither the floor nor, through a chain of touching parts, a part that does. */
  floatingParts: string[];
  /** Closed parts whose triangles wind inward, so their signed volume is negative. */
  invertedParts: string[];
}

/** Reads accessor `index` from the BIN chunk as `count` tuples of `components` numbers. */
function readAccessor(gltf: Gltf, bin: Uint8Array, index: number, components: number): number[][] {
  const accessor = accessorAt(gltf.accessors, index);
  const componentBytes =
    accessor.componentType === FLOAT_COMPONENT
      ? 4
      : indexComponentBytes.get(accessor.componentType ?? -1);
  if (componentBytes === undefined) {
    throw new Error(`GLB accessor ${String(index)} has an unsupported component type`);
  }
  if (accessor.bufferView === undefined) {
    throw new Error(`GLB accessor ${String(index)} has no buffer view`);
  }
  const bufferView = gltf.bufferViews[accessor.bufferView];
  if (bufferView === undefined) {
    throw new Error(`GLB names buffer view ${String(accessor.bufferView)}, which does not exist`);
  }
  const elementBytes = componentBytes * components;
  const stride = bufferView.byteStride ?? elementBytes;
  const start = bufferView.byteOffset + accessor.byteOffset;
  const end = start + stride * Math.max(accessor.count - 1, 0) + elementBytes;
  if (end > bufferView.byteOffset + bufferView.byteLength || end > bin.byteLength) {
    throw new Error(`GLB accessor ${String(index)} runs past its buffer view`);
  }
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = (offset: number): number => {
    if (componentBytes === 4) {
      return accessor.componentType === FLOAT_COMPONENT
        ? view.getFloat32(offset, true)
        : view.getUint32(offset, true);
    }
    return componentBytes === 2 ? view.getUint16(offset, true) : view.getUint8(offset);
  };
  const values: number[][] = [];
  for (let element = 0; element < accessor.count; element++) {
    const tuple: number[] = [];
    for (let component = 0; component < components; component++) {
      tuple.push(read(start + element * stride + component * componentBytes));
    }
    values.push(tuple);
  }
  return values;
}

function findRoot(parents: number[], vertex: number): number {
  let root = vertex;
  while (parents[root] !== root) root = parents[root] ?? root;
  return root;
}

/** The welded triangles of one mesh, across its primitives, as vertex ids into `positions`. */
function weldedTriangles(
  gltf: Gltf,
  bin: Uint8Array,
  mesh: Gltf["meshes"][number],
): { positions: Vector[]; triangles: Vector[] } {
  const ids = new Map<string, number>();
  const positions: Vector[] = [];
  const triangles: Vector[] = [];
  for (const primitive of mesh.primitives) {
    trianglesOf(primitive, gltf.accessors);
    const position = primitive.attributes.POSITION;
    if (position === undefined) continue;
    const welded = readAccessor(gltf, bin, position, 3).map(([x = 0, y = 0, z = 0]) => {
      const key = [x, y, z].map((value) => Math.round(value * WELD_STEPS_PER_STUD)).join(",");
      let id = ids.get(key);
      if (id === undefined) {
        id = positions.length;
        ids.set(key, id);
        positions.push([x, y, z]);
      }
      return id;
    });
    const order =
      primitive.indices === undefined
        ? welded.map((_, vertex) => vertex)
        : readAccessor(gltf, bin, primitive.indices, 1).map(([vertex = 0]) => vertex);
    for (let corner = 0; corner + 2 < order.length; corner += 3) {
      const triangle = [order[corner], order[corner + 1], order[corner + 2]].map((vertex) => {
        const id = welded[vertex ?? -1];
        if (id === undefined) throw new Error("GLB index points past its position accessor");
        return id;
      });
      triangles.push(triangle as Vector);
    }
  }
  return { positions, triangles };
}

/**
 * The connected parts of every mesh in a GLB, found by welding vertex positions and joining triangles that
 * share a vertex. Node transforms are not applied, as in `readGlbStructure`.
 */
export function readGlbParts(glb: Uint8Array): GlbPart[] {
  const { json, bin } = readChunks(glb);
  if (bin === undefined) throw new Error("GLB has no BIN chunk");
  const gltf = gltfSchema.parse(json);
  const parts: GlbPart[] = [];
  for (const mesh of gltf.meshes) {
    const { positions, triangles } = weldedTriangles(gltf, bin, mesh);
    const parents = positions.map((_, vertex) => vertex);
    for (const [a, b, c] of triangles) {
      parents[findRoot(parents, b)] = findRoot(parents, a);
      parents[findRoot(parents, c)] = findRoot(parents, a);
    }
    const byRoot = new Map<number, { part: GlbPart; edges: Map<string, number> }>();
    for (const triangle of triangles) {
      const root = findRoot(parents, triangle[0]);
      let entry = byRoot.get(root);
      if (entry === undefined) {
        entry = {
          part: {
            mesh: mesh.name ?? "",
            min: [Infinity, Infinity, Infinity],
            max: [-Infinity, -Infinity, -Infinity],
            closed: true,
            signedVolume: 0,
          },
          edges: new Map(),
        };
        byRoot.set(root, entry);
      }
      const [a, b, c] = triangle.map((vertex) => positions[vertex] ?? [0, 0, 0]) as [
        Vector,
        Vector,
        Vector,
      ];
      for (const corner of [a, b, c]) {
        for (let axis = 0; axis < 3; axis++) {
          entry.part.min[axis] = Math.min(entry.part.min[axis] ?? Infinity, corner[axis] ?? 0);
          entry.part.max[axis] = Math.max(entry.part.max[axis] ?? -Infinity, corner[axis] ?? 0);
        }
      }
      entry.part.signedVolume +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) -
          a[1] * (b[0] * c[2] - b[2] * c[0]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6;
      for (const [from, to] of [
        [triangle[0], triangle[1]],
        [triangle[1], triangle[2]],
        [triangle[2], triangle[0]],
      ] as const) {
        const edge = from < to ? `${String(from)}-${String(to)}` : `${String(to)}-${String(from)}`;
        entry.edges.set(edge, (entry.edges.get(edge) ?? 0) + 1);
      }
    }
    for (const { part, edges } of byRoot.values()) {
      part.closed = [...edges.values()].every((count) => count % 2 === 0);
      parts.push(part);
    }
  }
  return parts;
}

function boxesTouch(first: GlbPart, second: GlbPart, tolerance: number): boolean {
  for (let axis = 0; axis < 3; axis++) {
    const gap = Math.max(
      (first.min[axis] ?? 0) - (second.max[axis] ?? 0),
      (second.min[axis] ?? 0) - (first.max[axis] ?? 0),
    );
    if (gap > tolerance) return false;
  }
  return true;
}

/**
 * Checks parts against floating and inverted normals: a part must reach the floor (y = 0, where recipe
 * centers are measured from) within `tolerance` studs, or touch such a part by bounding boxes, directly or
 * through other parts; a closed part must have a non-negative signed volume (outward winding).
 */
export function checkGlbParts(parts: GlbPart[], tolerance: number): GlbChecks {
  const names = new Map<string, number>();
  const labels = parts.map((part) => {
    const count = names.get(part.mesh) ?? 0;
    names.set(part.mesh, count + 1);
    return `${part.mesh}#${String(count + 1)}`;
  });
  const supported = parts.map((part) => part.min[1] <= tolerance);
  const queue = parts.flatMap((_, index) => (supported[index] === true ? [index] : []));
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const from = parts[next];
    if (from === undefined) continue;
    parts.forEach((part, index) => {
      if (supported[index] !== true && boxesTouch(from, part, tolerance)) {
        supported[index] = true;
        queue.push(index);
      }
    });
  }
  const floatingParts = labels.filter((_, index) => supported[index] !== true);
  const invertedParts = labels.filter((_, index) => {
    const part = parts[index];
    return part !== undefined && part.closed && part.signedVolume < -INVERTED_VOLUME_EPSILON;
  });
  return {
    passed: parts.length > 0 && floatingParts.length === 0 && invertedParts.length === 0,
    parts: parts.length,
    floatingParts,
    invertedParts,
  };
}
