import { config } from "../config.ts";
import { createSeededRandom } from "../shared/seeded-random.ts";
import type { HeightmapFill } from "./map-spec.ts";

/** Surface material of a column, an index into `TerrainChunk.layerMaterials`. */
const layerOrder = ["sand", "grass", "rock", "snow"] as const;
const octaves = 5;
const maxDropletSteps = 30;

/** The ground of a heightmap fill: `heights[column * rows + row]` studs above the box bottom, one per voxel column. */
export interface Heightmap {
  columns: number;
  rows: number;
  heights: number[];
}

/** One rectangle of columns that `build-map.luau` writes with one WriteVoxels call. */
export interface TerrainChunk {
  /** Minimum corner of the chunk's region in studs; the region is `columns` by `rows` voxels wide and `voxelsY` tall. */
  origin: { x: number; y: number; z: number };
  columns: number;
  rows: number;
  voxelsY: number;
  voxelStuds: number;
  /** Material below each column's surface layer. */
  baseMaterial: string;
  /** Surface materials in `layerOrder`: sand, grass, rock, snow. */
  layerMaterials: string[];
  /** Per column (`column * rows + row`) the index into `layerMaterials` of its surface voxel. */
  surface: number[];
  /** Per column the surface height in studs above the box bottom. */
  heights: number[];
}

/** A deterministic value in [0, 1) for one lattice point of a seed. */
function latticeValue(ix: number, iz: number, seed: number): number {
  let hash = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function smooth(fraction: number): number {
  return fraction * fraction * (3 - 2 * fraction);
}

/** Value noise at a point in lattice units, in [0, 1). */
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const north = latticeValue(ix, iz, seed) * (1 - fx) + latticeValue(ix + 1, iz, seed) * fx;
  const south = latticeValue(ix, iz + 1, seed) * (1 - fx) + latticeValue(ix + 1, iz + 1, seed) * fx;
  return north * (1 - fz) + south * fz;
}

/** Fractal noise: octaves of value noise, each twice as fine and half as strong. */
function fractalNoise(x: number, z: number, seed: number): number {
  let total = 0;
  let strength = 1;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave++) {
    total += strength * valueNoise(x * frequency, z * frequency, seed + octave * 101);
    strength /= 2;
    frequency *= 2;
  }
  return total;
}

/** Rescales heights in place so the lowest is 0 and the highest `top`; a flat field becomes all 0. */
function stretchTo(heights: number[], top: number): void {
  const lowest = Math.min(...heights);
  const highest = Math.max(...heights);
  const range = highest - lowest;
  for (const [index, height] of heights.entries()) {
    heights[index] = range === 0 ? 0 : ((height - lowest) / range) * top;
  }
}

/** Bilinear height and downhill gradient (studs per column) at a fractional column position. */
function sample(heightmap: Heightmap, x: number, z: number) {
  const column = Math.floor(x);
  const row = Math.floor(z);
  const fx = x - column;
  const fz = z - row;
  const at = (c: number, r: number) => heightmap.heights[c * heightmap.rows + r] ?? 0;
  const h00 = at(column, row);
  const h10 = at(column + 1, row);
  const h01 = at(column, row + 1);
  const h11 = at(column + 1, row + 1);
  return {
    height: h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz,
    gradientX: (h10 - h00) * (1 - fz) + (h11 - h01) * fz,
    gradientZ: (h01 - h00) * (1 - fx) + (h11 - h10) * fx,
    column,
    row,
    fx,
    fz,
  };
}

/** Adds `amount` studs split over the four columns around a fractional position by bilinear weight. */
function addAround(heightmap: Heightmap, position: ReturnType<typeof sample>, amount: number) {
  const { column, row, fx, fz } = position;
  const weights: [number, number, number][] = [
    [column, row, (1 - fx) * (1 - fz)],
    [column + 1, row, fx * (1 - fz)],
    [column, row + 1, (1 - fx) * fz],
    [column + 1, row + 1, fx * fz],
  ];
  for (const [c, r, weight] of weights) {
    const index = c * heightmap.rows + r;
    heightmap.heights[index] = (heightmap.heights[index] ?? 0) + amount * weight;
  }
}

/**
 * Particle hydraulic erosion: each droplet runs downhill, picks up sediment where it is fast and steep and drops it
 * where it slows or climbs, carving valleys and softening ridges. Seeded, so a seed reproduces the terrain.
 */
function erode(heightmap: Heightmap, droplets: number, random: () => number): void {
  const inertia = 0.05;
  const capacityFactor = 4;
  const erodeSpeed = 0.3;
  const depositSpeed = 0.3;
  const gravity = 4;
  const evaporation = 0.02;
  const minSlope = 0.01;
  for (let droplet = 0; droplet < droplets; droplet++) {
    let x = random() * (heightmap.columns - 1.001);
    let z = random() * (heightmap.rows - 1.001);
    let directionX = 0;
    let directionZ = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;
    for (let step = 0; step < maxDropletSteps; step++) {
      const here = sample(heightmap, x, z);
      directionX = directionX * inertia - here.gradientX * (1 - inertia);
      directionZ = directionZ * inertia - here.gradientZ * (1 - inertia);
      const length = Math.hypot(directionX, directionZ);
      if (length === 0) break;
      directionX /= length;
      directionZ /= length;
      const nextX = x + directionX;
      const nextZ = z + directionZ;
      if (nextX < 0 || nextZ < 0 || nextX >= heightmap.columns - 1 || nextZ >= heightmap.rows - 1) {
        break;
      }
      const drop = here.height - sample(heightmap, nextX, nextZ).height;
      const capacity = Math.max(drop, minSlope) * speed * water * capacityFactor;
      if (sediment > capacity || drop < 0) {
        const dropped = drop < 0 ? Math.min(-drop, sediment) : (sediment - capacity) * depositSpeed;
        sediment -= dropped;
        addAround(heightmap, here, dropped);
      } else {
        const taken = Math.min((capacity - sediment) * erodeSpeed, drop);
        sediment += taken;
        addAround(heightmap, here, -taken);
      }
      speed = Math.sqrt(Math.max(speed * speed + drop * gravity, 0));
      water *= 1 - evaporation;
      x = nextX;
      z = nextZ;
    }
  }
}

/** The ground of a heightmap fill: fractal noise stretched to the box height, eroded, then stretched again. */
export function generateHeightmap(fill: HeightmapFill, defaultSeed: number): Heightmap {
  const seed = fill.seed ?? defaultSeed;
  const columns = Math.round(fill.size.x / config.terrainVoxelStuds);
  const rows = Math.round(fill.size.z / config.terrainVoxelStuds);
  const scale = fill.noiseScaleStuds / config.terrainVoxelStuds;
  const heights: number[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      heights.push(fractalNoise((column + 0.5) / scale, (row + 0.5) / scale, seed));
    }
  }
  stretchTo(heights, fill.size.y);
  const heightmap: Heightmap = { columns, rows, heights };
  if (fill.erosion > 0 && columns > 2 && rows > 2) {
    erode(heightmap, Math.round(fill.erosion * columns * rows), createSeededRandom(seed + 7919));
    stretchTo(heightmap.heights, fill.size.y);
  }
  return heightmap;
}

/** Index into `layerOrder` of one column's surface: snow high, sand low, rock on steep slopes, grass elsewhere. */
function surfaceLayerOf(
  heightmap: Heightmap,
  column: number,
  row: number,
  boxHeight: number,
): number {
  const at = (c: number, r: number) =>
    heightmap.heights[
      Math.min(Math.max(c, 0), heightmap.columns - 1) * heightmap.rows +
        Math.min(Math.max(r, 0), heightmap.rows - 1)
    ] ?? 0;
  const height = at(column, row);
  const slopeX = (at(column + 1, row) - at(column - 1, row)) / (2 * config.terrainVoxelStuds);
  const slopeZ = (at(column, row + 1) - at(column, row - 1)) / (2 * config.terrainVoxelStuds);
  if (height >= boxHeight * config.terrainSnowFraction) return layerOrder.indexOf("snow");
  if (height <= boxHeight * config.terrainSandFraction) return layerOrder.indexOf("sand");
  if (Math.hypot(slopeX, slopeZ) >= config.terrainRockSlope) return layerOrder.indexOf("rock");
  return layerOrder.indexOf("grass");
}

/** The heightmap fill cut into chunks of at most `terrainChunkColumns` columns a side, each one WriteVoxels call. */
export function terrainChunks(fill: HeightmapFill, defaultSeed: number): TerrainChunk[] {
  const heightmap = generateHeightmap(fill, defaultSeed);
  const bottom = fill.center.y - fill.size.y / 2;
  const minX = fill.center.x - fill.size.x / 2;
  const minZ = fill.center.z - fill.size.z / 2;
  const chunks: TerrainChunk[] = [];
  for (
    let firstColumn = 0;
    firstColumn < heightmap.columns;
    firstColumn += config.terrainChunkColumns
  ) {
    for (let firstRow = 0; firstRow < heightmap.rows; firstRow += config.terrainChunkColumns) {
      const columns = Math.min(config.terrainChunkColumns, heightmap.columns - firstColumn);
      const rows = Math.min(config.terrainChunkColumns, heightmap.rows - firstRow);
      const surface: number[] = [];
      const heights: number[] = [];
      for (let column = firstColumn; column < firstColumn + columns; column++) {
        for (let row = firstRow; row < firstRow + rows; row++) {
          surface.push(surfaceLayerOf(heightmap, column, row, fill.size.y));
          heights.push(
            Math.round((heightmap.heights[column * heightmap.rows + row] ?? 0) * 100) / 100,
          );
        }
      }
      const chunk: TerrainChunk = {
        origin: {
          x: minX + firstColumn * config.terrainVoxelStuds,
          y: bottom,
          z: minZ + firstRow * config.terrainVoxelStuds,
        },
        columns,
        rows,
        voxelsY: Math.round(fill.size.y / config.terrainVoxelStuds),
        voxelStuds: config.terrainVoxelStuds,
        baseMaterial: fill.material,
        layerMaterials: layerOrder.map((layer) => fill.layers[layer]),
        surface,
        heights,
      };
      if (JSON.stringify(chunk).length >= config.executeLuauMaxResultChars) {
        throw new Error("A terrain chunk exceeds the Luau size limit; lower terrainChunkColumns.");
      }
      chunks.push(chunk);
    }
  }
  return chunks;
}

/** The voxel columns' surface voxels that WriteVoxels fills, counted from the heights: what the smoke expects Studio to hold. */
export function solidVoxelCount(chunks: TerrainChunk[]): number {
  let solid = 0;
  for (const chunk of chunks) {
    for (const height of chunk.heights) {
      solid += Math.ceil(height / chunk.voxelStuds - 1e-9);
    }
  }
  return solid;
}
