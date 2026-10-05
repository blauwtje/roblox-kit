import { config } from "../config.ts";
import { createSeededRandom } from "../shared/seeded-random.ts";
import type { Vector } from "./map-layout.ts";

/** The surface of a room a pattern covers. */
export type PatternSurface = "floor" | "ceiling";

/**
 * A kind of tile. `neighbors` lists the ids that may sit beside it on any of its four sides, and must be
 * symmetric across the set. A tile with a `role` becomes a part; one without leaves the surface bare.
 */
export interface TileKind {
  id: string;
  weight: number;
  role?: "trim" | "accent";
  neighbors: readonly string[];
}

/**
 * Sizes of the patterns, in studs, until they move to `config` (kept here because this task edits no other file).
 * `maxTileKinds` is the width of the bit masks the solver keeps its candidates in.
 */
export const patternDimensions = Object.freeze({
  /** A grid cell's side, and the gap left between neighboring tile parts. */
  cellStuds: 4,
  gapStuds: 0.2,
  /** Thickness of a tile part, laid on the floor or hung under the ceiling. */
  thicknessStuds: 0.05,
  /** Distance kept from the wall faces, so tiles stay clear of the baseboards and crowns. */
  wallMarginStuds: 0.5,
  /** Failed placements the solver tolerates before it gives up and the surface stays bare. */
  maxFailedPlacements: 2000,
  /** Distance between the seeds of two rooms and of two surfaces of one room. */
  roomSeedStride: 1009,
  ceilingSeedOffset: 7919,
  maxTileKinds: 30,
});

/**
 * The default tile set: bare floor, an inlay in the trim surface and an accent that is ringed by inlay, so accents
 * never touch bare floor or each other and read as a rug or medallion rather than as scattered dots.
 */
export const defaultTileKinds: readonly TileKind[] = Object.freeze([
  { id: "plain", weight: 6, neighbors: ["plain", "inlay"] },
  { id: "inlay", weight: 3, role: "trim", neighbors: ["plain", "inlay", "accent"] },
  { id: "accent", weight: 1, role: "accent", neighbors: ["inlay"] },
]);

export interface TileSolution {
  /** `tiles[row][column]` is an index into the tile kinds. */
  tiles: number[][];
  /** Placements that led to a contradiction and were undone. */
  backtracks: number;
}

function bitCount(mask: number): number {
  let count = 0;
  for (let rest = mask; rest !== 0; rest &= rest - 1) {
    count += 1;
  }
  return count;
}

/** Bit masks, one per tile kind, of the kinds that may stand beside it. */
function neighborMasks(kinds: readonly TileKind[]): number[] {
  if (kinds.length > patternDimensions.maxTileKinds) {
    throw new Error(
      `A tile set holds at most ${String(patternDimensions.maxTileKinds)} kinds, got ${String(kinds.length)}.`,
    );
  }
  return kinds.map((kind) => {
    let mask = 0;
    for (const neighborId of kind.neighbors) {
      const index = kinds.findIndex((candidate) => candidate.id === neighborId);
      if (index < 0) {
        throw new Error(`Tile "${kind.id}" lists the unknown neighbor "${neighborId}".`);
      }
      mask |= 1 << index;
    }
    return mask;
  });
}

/**
 * Narrows the candidate masks until each candidate has a neighbor-compatible candidate beside it, starting from
 * `queue`. False when a cell is left with none.
 */
function propagate(
  domains: number[],
  columns: number,
  rows: number,
  masks: readonly number[],
  queue: number[],
): boolean {
  while (queue.length > 0) {
    const cell = queue.pop() ?? 0;
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    let support = 0;
    for (let index = 0; index < masks.length; index += 1) {
      if ((domains[cell] ?? 0) & (1 << index)) {
        support |= masks[index] ?? 0;
      }
    }
    const around = [
      column > 0 ? cell - 1 : -1,
      column < columns - 1 ? cell + 1 : -1,
      row > 0 ? cell - columns : -1,
      row < rows - 1 ? cell + columns : -1,
    ];
    for (const other of around) {
      if (other < 0) continue;
      const before = domains[other] ?? 0;
      const after = before & support;
      if (after === 0) return false;
      if (after !== before) {
        domains[other] = after;
        queue.push(other);
      }
    }
  }
  return true;
}

/** A random cell among those with the fewest candidates above one; -1 when every cell is decided. */
function lowestEntropyCell(domains: readonly number[], random: () => number): number {
  let best = Infinity;
  let cells: number[] = [];
  for (const [cell, domain] of domains.entries()) {
    const count = bitCount(domain);
    if (count < 2 || count > best) continue;
    if (count < best) {
      best = count;
      cells = [];
    }
    cells.push(cell);
  }
  return cells.length === 0 ? -1 : (cells[Math.floor(random() * cells.length)] ?? -1);
}

/** A kind index among the set bits of `mask`, chosen by weight. */
function weightedPick(mask: number, kinds: readonly TileKind[], random: () => number): number {
  const candidates = kinds.map((_, index) => index).filter((index) => mask & (1 << index));
  const total = candidates.reduce((sum, index) => sum + (kinds[index]?.weight ?? 0), 0);
  let remaining = random() * total;
  for (const index of candidates) {
    remaining -= kinds[index]?.weight ?? 0;
    if (remaining < 0) return index;
  }
  return candidates[candidates.length - 1] ?? 0;
}

interface Decision {
  /** The candidates before this decision, which every undo returns to. */
  domains: number[];
  cell: number;
  /** The kinds not yet tried in this cell. */
  untried: number;
}

/**
 * Wave function collapse over a `columns` by `rows` grid: collapses the cell with the fewest candidates to a
 * weighted random kind, narrows its neighbors, and on a contradiction undoes the choice, trying another kind and
 * then the previous cell's. Undefined when the set cannot cover the grid or after
 * `patternDimensions.maxFailedPlacements` failed placements. Deterministic for a given `random`.
 */
export function solveTileGrid(
  columns: number,
  rows: number,
  kinds: readonly TileKind[],
  random: () => number,
): TileSolution | undefined {
  const masks = neighborMasks(kinds);
  const cellCount = columns * rows;
  let domains = Array.from({ length: cellCount }, () => (1 << kinds.length) - 1);
  const everyCell = Array.from({ length: cellCount }, (_, cell) => cell);
  if (!propagate(domains, columns, rows, masks, everyCell)) return undefined;
  const stack: Decision[] = [];
  let backtracks = 0;
  for (;;) {
    const cell = lowestEntropyCell(domains, random);
    if (cell < 0) break;
    stack.push({ domains, cell, untried: domains[cell] ?? 0 });
    for (;;) {
      const decision = stack[stack.length - 1];
      if (decision === undefined) return undefined;
      if (decision.untried === 0) {
        stack.pop();
        continue;
      }
      const pick = weightedPick(decision.untried, kinds, random);
      decision.untried &= ~(1 << pick);
      const trial = decision.domains.slice();
      trial[decision.cell] = 1 << pick;
      if (propagate(trial, columns, rows, masks, [decision.cell])) {
        domains = trial;
        break;
      }
      backtracks += 1;
      if (backtracks > patternDimensions.maxFailedPlacements) return undefined;
    }
  }
  const tiles = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => Math.log2(domains[row * columns + column] ?? 1)),
  );
  return { tiles, backtracks };
}

/** The room fields a pattern needs. */
export interface PatternRoom {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface PatternTilePart {
  name: string;
  room: string;
  role: "trim" | "accent";
  position: Vector;
  size: Vector;
}

export interface SurfacePatternInput {
  room: PatternRoom;
  /** Index of the room in the map, which spreads the seeds of different rooms. */
  roomIndex: number;
  surface: PatternSurface;
  wallThickness: number;
  wallHeight: number;
  seed: number;
  kinds?: readonly TileKind[];
}

/**
 * One thin part per tile with a role, laid over the room's floor or hung under its ceiling on a grid of
 * `patternDimensions.cellStuds` cells centered in the room. A room too small for a 2 by 2 grid, or a tile set
 * the grid cannot be covered with, gives none. Deterministic: the same input gives the same tiles.
 */
export function surfacePatternTiles(input: SurfacePatternInput): PatternTilePart[] {
  const { room, surface, wallThickness, wallHeight } = input;
  const kinds = input.kinds ?? defaultTileKinds;
  const { cellStuds, gapStuds, thicknessStuds, wallMarginStuds } = patternDimensions;
  const inset = 2 * (wallThickness + wallMarginStuds);
  const columns = Math.floor((room.width - inset) / cellStuds);
  const rows = Math.floor((room.depth - inset) / cellStuds);
  if (columns < 2 || rows < 2) return [];
  const seed =
    input.seed +
    input.roomIndex * patternDimensions.roomSeedStride +
    (surface === "ceiling" ? patternDimensions.ceilingSeedOffset : 0);
  const solution = solveTileGrid(columns, rows, kinds, createSeededRandom(seed));
  if (solution === undefined) return [];
  const y =
    surface === "floor"
      ? config.floorLiftStuds + thicknessStuds / 2
      : wallHeight - thicknessStuds / 2;
  const parts: PatternTilePart[] = [];
  for (const [row, tilesOfRow] of solution.tiles.entries()) {
    for (const [column, tileIndex] of tilesOfRow.entries()) {
      const role = kinds[tileIndex]?.role;
      if (role === undefined) continue;
      parts.push({
        name: `${room.name}-${surface}-tile-${String(column)}-${String(row)}`,
        room: room.name,
        role,
        position: {
          x: room.x + (column - (columns - 1) / 2) * cellStuds,
          y,
          z: room.z + (row - (rows - 1) / 2) * cellStuds,
        },
        size: { x: cellStuds - gapStuds, y: thicknessStuds, z: cellStuds - gapStuds },
      });
    }
  }
  return parts;
}
