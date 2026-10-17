import type { RgbaImage } from "./encode-png.ts";
import { type CellRegion, regionEdgeStats } from "./edges.ts";
import { oklabChroma, srgbToOklab } from "./oklab.ts";
import { visionConfig } from "./vision-config.ts";

export interface GridCell {
  name: string;
  lightness: number;
  chroma: number;
  edgeDensity: number;
  edgeAngle: number | null;
}

export interface ValueStructure {
  histogram: number[];
  tones: { shadows: number; mids: number; lights: number };
  cells: GridCell[];
}

/** Column letter then row number, counting from A1 at the top left: A1, B1, ..., A2. */
export function gridCellName(column: number, row: number): string {
  let letters = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return `${letters}${String(row + 1)}`;
}

function regionSums(region: CellRegion, width: number, planes: Float32Array[]): number[] {
  const sums = planes.map(() => 0);
  const regionWidth = region.right - region.left;
  const area = regionWidth * (region.bottom - region.top);
  for (let i = 0; i < area; i++) {
    const offset =
      (region.top + Math.floor(i / regionWidth)) * width + region.left + (i % regionWidth);
    planes.forEach((plane, index) => (sums[index] = (sums[index] ?? 0) + (plane[offset] ?? 0)));
  }
  return sums;
}

export function measureValueStructure(
  image: RgbaImage,
  grid: { columns: number; rows: number },
): ValueStructure {
  const { width, height, data } = image;
  const lightness = new Float32Array(width * height);
  const chroma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const color = srgbToOklab(data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0);
    lightness[i] = color.l;
    chroma[i] = oklabChroma(color);
  }
  const bins = visionConfig.lightnessBins;
  const histogram = new Array<number>(bins).fill(0);
  const tones = { shadows: 0, mids: 0, lights: 0 };
  for (const l of lightness) {
    const bin = Math.min(bins - 1, Math.max(0, Math.floor(l * bins)));
    histogram[bin] = (histogram[bin] ?? 0) + 1;
    if (l < visionConfig.shadowMaxLightness) tones.shadows++;
    else if (l >= visionConfig.lightMinLightness) tones.lights++;
    else tones.mids++;
  }
  const total = Math.max(1, width * height);
  const cells: GridCell[] = [];
  for (let index = 0; index < grid.rows * grid.columns; index++) {
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const region: CellRegion = {
      left: Math.floor((column * width) / grid.columns),
      right: Math.floor(((column + 1) * width) / grid.columns),
      top: Math.floor((row * height) / grid.rows),
      bottom: Math.floor(((row + 1) * height) / grid.rows),
    };
    const area = Math.max(1, (region.right - region.left) * (region.bottom - region.top));
    const sums = regionSums(region, width, [lightness, chroma]);
    cells.push({
      name: gridCellName(column, row),
      lightness: (sums[0] ?? 0) / area,
      chroma: (sums[1] ?? 0) / area,
      ...regionEdgeStats(lightness, { width, height }, region),
    });
  }
  return {
    histogram: histogram.map((count) => count / total),
    tones: {
      shadows: tones.shadows / total,
      mids: tones.mids / total,
      lights: tones.lights / total,
    },
    cells,
  };
}
