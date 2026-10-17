import type { RgbaImage } from "./encode-png.ts";
import { type Oklab, oklabDistanceSquared, srgbToOklab } from "./oklab.ts";
import { gridCellName } from "./value-structure.ts";

export interface BoxPx {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Region {
  id: number;
  boxPx: BoxPx;
  cells: string[];
  share: number;
  oklab: Oklab;
}

const settings = Object.freeze({
  maxSide: 96,
  seedsPerSide: 6,
  iterations: 5,
  compactness: 0.1,
  minRegions: 12,
  maxRegions: 25,
  mergeDistance: 0.06,
  cellCover: 0.2,
});

interface Field {
  width: number;
  height: number;
  step: number;
  colors: Oklab[];
}

function blockColor(image: RgbaImage, block: { x: number; y: number; step: number }): Oklab {
  const sums = [0, 0, 0];
  const left = block.x * block.step;
  const top = block.y * block.step;
  const width = Math.min(image.width, left + block.step) - left;
  const height = Math.min(image.height, top + block.step) - top;
  for (let i = 0; i < width * height * 3; i++) {
    const at =
      ((top + Math.floor(i / 3 / width)) * image.width + left + (Math.floor(i / 3) % width)) * 4;
    sums[i % 3] = (sums[i % 3] ?? 0) + (image.data[at + (i % 3)] ?? 0);
  }
  const count = width * height;
  const [r = 0, g = 0, b = 0] = sums.map((sum) => sum / count / 255);
  return srgbToOklab(r, g, b);
}

function toField(image: RgbaImage): Field {
  const step = Math.max(1, Math.ceil(Math.max(image.width, image.height) / settings.maxSide));
  const width = Math.ceil(image.width / step);
  const height = Math.ceil(image.height / step);
  const colors: Oklab[] = [];
  for (let i = 0; i < width * height; i++)
    colors.push(blockColor(image, { x: i % width, y: Math.floor(i / width), step }));
  return { width, height, step, colors };
}

interface Center {
  color: Oklab;
  x: number;
  y: number;
}

function seedCenters(field: Field): Center[] {
  const centers: Center[] = [];
  const n = settings.seedsPerSide;
  for (let i = 0; i < n * n; i++) {
    const x = Math.min(field.width - 1, Math.floor(((i % n) + 0.5) * (field.width / n)));
    const y = Math.min(
      field.height - 1,
      Math.floor((Math.floor(i / n) + 0.5) * (field.height / n)),
    );
    centers.push({ color: field.colors[y * field.width + x] as Oklab, x, y });
  }
  return centers;
}

function nearestCenter(field: Field, centers: Center[], index: number): number {
  const x = index % field.width;
  const y = Math.floor(index / field.width);
  const spacing = Math.sqrt((field.width * field.height) / centers.length);
  const color = field.colors[index] as Oklab;
  let best = 0;
  let bestDistance = Infinity;
  centers.forEach((center, k) => {
    const space = ((x - center.x) ** 2 + (y - center.y) ** 2) / spacing ** 2;
    const distance = oklabDistanceSquared(color, center.color) + settings.compactness ** 2 * space;
    if (distance < bestDistance) [best, bestDistance] = [k, distance];
  });
  return best;
}

function moveCenters(field: Field, centers: Center[], labels: number[]): Center[] {
  const sums = centers.map(() => ({ l: 0, a: 0, b: 0, x: 0, y: 0, n: 0 }));
  labels.forEach((label, i) => {
    const sum = sums[label];
    const color = field.colors[i];
    if (!sum || !color) return;
    sum.l += color.l;
    sum.a += color.a;
    sum.b += color.b;
    sum.x += i % field.width;
    sum.y += Math.floor(i / field.width);
    sum.n++;
  });
  return centers.map((center, k) => {
    const s = sums[k];
    if (!s || s.n === 0) return center;
    return { color: { l: s.l / s.n, a: s.a / s.n, b: s.b / s.n }, x: s.x / s.n, y: s.y / s.n };
  });
}

function slic(field: Field): number[] {
  let centers = seedCenters(field);
  let labels: number[] = [];
  for (let round = 0; round < settings.iterations; round++) {
    labels = field.colors.map((_, i) => nearestCenter(field, centers, i));
    centers = moveCenters(field, centers, labels);
  }
  return labels;
}

function regionColors(field: Field, labels: number[]): Map<number, Oklab & { n: number }> {
  const stats = new Map<number, Oklab & { n: number }>();
  labels.forEach((label, i) => {
    const color = field.colors[i] as Oklab;
    const sum = stats.get(label) ?? { l: 0, a: 0, b: 0, n: 0 };
    stats.set(label, { l: sum.l + color.l, a: sum.a + color.a, b: sum.b + color.b, n: sum.n + 1 });
  });
  return stats;
}

function mean(sum: Oklab & { n: number }): Oklab {
  return { l: sum.l / sum.n, a: sum.a / sum.n, b: sum.b / sum.n };
}

function closestNeighbors(field: Field, labels: number[]): [number, number, number] | null {
  const means = new Map([...regionColors(field, labels)].map(([k, sum]) => [k, mean(sum)]));
  let best: [number, number, number] | null = null;
  labels.forEach((label, i) => {
    const neighbors = [i % field.width < field.width - 1 ? i + 1 : -1, i + field.width];
    for (const j of neighbors) {
      const other = labels[j];
      if (other === undefined || other === label) continue;
      const distance = oklabDistanceSquared(means.get(label) as Oklab, means.get(other) as Oklab);
      if (!best || distance < best[2]) best = [label, other, distance];
    }
  });
  return best;
}

function mergeRegions(field: Field, initial: number[]): number[] {
  const labels = [...initial];
  const limit = settings.mergeDistance ** 2;
  for (;;) {
    const count = new Set(labels).size;
    const pair = closestNeighbors(field, labels);
    if (!pair || count <= settings.minRegions) return labels;
    if (count <= settings.maxRegions && pair[2] > limit) return labels;
    const [keep, drop] = pair;
    labels.forEach((label, i) => {
      if (label === drop) labels[i] = keep;
    });
  }
}

function cellShares(field: Field, labels: number[], grid: { columns: number; rows: number }) {
  const shares = new Map<number, Map<string, number>>();
  labels.forEach((label, i) => {
    const column = Math.floor(((i % field.width) * grid.columns) / field.width);
    const row = Math.floor((Math.floor(i / field.width) * grid.rows) / field.height);
    const name = gridCellName(column, row);
    const cells = shares.get(label) ?? new Map<string, number>();
    cells.set(name, (cells.get(name) ?? 0) + 1);
    shares.set(label, cells);
  });
  return shares;
}

function cellTotals(field: Field, grid: { columns: number; rows: number }): Map<string, number> {
  const totals = new Map<string, number>();
  for (let i = 0; i < field.width * field.height; i++) {
    const column = Math.floor(((i % field.width) * grid.columns) / field.width);
    const row = Math.floor((Math.floor(i / field.width) * grid.rows) / field.height);
    const name = gridCellName(column, row);
    totals.set(name, (totals.get(name) ?? 0) + 1);
  }
  return totals;
}

function boxOf(field: Field, labels: number[], label: number): BoxPx {
  const box = { left: Infinity, top: Infinity, right: 0, bottom: 0 };
  labels.forEach((other, i) => {
    if (other !== label) return;
    const x = i % field.width;
    const y = Math.floor(i / field.width);
    box.left = Math.min(box.left, x);
    box.top = Math.min(box.top, y);
    box.right = Math.max(box.right, x + 1);
    box.bottom = Math.max(box.bottom, y + 1);
  });
  return {
    left: box.left * field.step,
    top: box.top * field.step,
    right: box.right * field.step,
    bottom: box.bottom * field.step,
  };
}

/** Segments an image into 12 to 25 merged SLIC regions, largest first, numbered from 1. */
export function segmentRegions(
  image: RgbaImage,
  grid: { columns: number; rows: number },
): Region[] {
  const field = toField(image);
  const labels = mergeRegions(field, slic(field));
  const colors = regionColors(field, labels);
  const shares = cellShares(field, labels, grid);
  const totals = cellTotals(field, grid);
  const regions = [...colors].map(([label, sum]) => {
    const box = boxOf(field, labels, label);
    const cells = [...(shares.get(label) ?? [])]
      .filter(([name, n]) => n / (totals.get(name) ?? 1) >= settings.cellCover)
      .map(([name]) => name);
    return { box, cells, share: sum.n / labels.length, oklab: mean(sum) };
  });
  regions.sort((first, second) => second.share - first.share);
  return regions.map((region, index) => ({
    id: index + 1,
    boxPx: {
      left: region.box.left,
      top: region.box.top,
      right: Math.min(image.width, region.box.right),
      bottom: Math.min(image.height, region.box.bottom),
    },
    cells: region.cells,
    share: region.share,
    oklab: region.oklab,
  }));
}
