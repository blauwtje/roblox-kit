import type { HeuristicDepthGrid } from "./heuristic-depth.ts";
import type { HorizonEstimate } from "./lines.ts";
import type { PaletteColor } from "./palette.ts";
import type { Region } from "./regions.ts";
import type { ValueStructure } from "./value-structure.ts";
import { gridCellName } from "./value-structure.ts";

export function colorFromRgb(color: PaletteColor): [number, number, number] {
  const [r, g, b] = color.color3;
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function table(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.join(" | ")).join("\n");
}

export function paletteTable(palette: PaletteColor[]): string {
  return table(
    ["#", "share", "hex", "Color3.fromRGB", "oklab L a b", "chroma", "hue", "material"],
    palette.map((color, index) => [
      String(index + 1),
      percent(color.share),
      color.srgbHex,
      `(${colorFromRgb(color).join(", ")})`,
      [color.oklab.l, color.oklab.a, color.oklab.b].map((n) => n.toFixed(3)).join(" "),
      color.chroma.toFixed(3),
      color.hueDegrees.toFixed(0),
      color.materialGuess,
    ]),
  );
}

export function valueTable(value: ValueStructure): string {
  const { shadows, mids, lights } = value.tones;
  return [
    `tones: shadows ${percent(shadows)}, mids ${percent(mids)}, lights ${percent(lights)}`,
    `lightness histogram (${String(value.histogram.length)} bins, dark to light): ${value.histogram
      .map(percent)
      .join(" ")}`,
  ].join("\n");
}

function digitGrid(columns: number, values: number[]): string {
  const rows: string[] = [];
  for (let start = 0; start < values.length; start += columns) {
    const row = values.slice(start, start + columns);
    rows.push(row.map((v) => String(Math.max(0, Math.min(9, Math.floor(v * 10))))).join(" "));
  }
  return rows.join("\n");
}

export function lightnessGrid(value: ValueStructure, columns: number): string {
  return digitGrid(
    columns,
    value.cells.map((cell) => cell.lightness),
  );
}

export function edgeGrid(value: ValueStructure, columns: number): string {
  return digitGrid(
    columns,
    value.cells.map((cell) => cell.edgeDensity),
  );
}

export function regionTable(regions: Region[]): string {
  return table(
    ["mark", "share", "box left,top,right,bottom", "oklab L a b", "cells"],
    regions.map((region) => [
      String(region.id),
      percent(region.share),
      `${String(region.boxPx.left)},${String(region.boxPx.top)},${String(region.boxPx.right)},${String(region.boxPx.bottom)}`,
      [region.oklab.l, region.oklab.a, region.oklab.b].map((n) => n.toFixed(3)).join(" "),
      region.cells.join(" "),
    ]),
  );
}

export function horizonLine(horizon: HorizonEstimate): string {
  return `horizon row ${horizon.horizonRow.toFixed(0)}, pitch ${horizon.pitchDegrees.toFixed(1)} degrees, confidence ${horizon.confidence.toFixed(2)}`;
}

export function depthTable(depth: HeuristicDepthGrid): string {
  const levels = depth.cells.map((row) => row.join(" ")).join("\n");
  return `depth levels 0 (near) to 9 (far), source ${depth.source}, ${String(depth.columns)} by ${String(depth.rows)}\n${levels}`;
}

export interface ImageAnalysis {
  label: string;
  width: number;
  height: number;
  grid: { columns: number; rows: number };
  palette: PaletteColor[];
  value: ValueStructure;
  regions: Region[];
  horizon: HorizonEstimate;
  depth: HeuristicDepthGrid;
}

export function summaryText(analysis: ImageAnalysis): string {
  const { grid, value } = analysis;
  const lastCell = gridCellName(grid.columns - 1, grid.rows - 1);
  return [
    `# ${analysis.label} (${String(analysis.width)} by ${String(analysis.height)})`,
    "## Palette",
    paletteTable(analysis.palette),
    "## Value structure",
    valueTable(value),
    `lightness 0 to 9 per cell (A1 to ${lastCell})`,
    lightnessGrid(value, grid.columns),
    "## Edge density",
    edgeGrid(value, grid.columns),
    "## Regions",
    regionTable(analysis.regions),
    "## Horizon",
    horizonLine(analysis.horizon),
    "## Depth",
    depthTable(analysis.depth),
  ].join("\n");
}
