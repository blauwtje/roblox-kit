import { visionConfig } from "./vision-config.ts";

export interface HeuristicDepthGrid {
  source: "heuristic";
  columns: number;
  rows: number;
  cells: number[][];
}

function levelForRow(centerRow: number, horizonRow: number, height: number): number {
  const farthest = visionConfig.depthLevels - 1;
  if (centerRow <= horizonRow) return farthest;
  const ratio = (height - horizonRow) / (centerRow - horizonRow);
  const level = Math.floor((ratio - 1) / visionConfig.depthRatioPerLevel);
  return Math.max(0, Math.min(farthest, level));
}

export function heuristicDepthGrid(
  size: { width: number; height: number },
  horizonRow: number,
): HeuristicDepthGrid {
  const { depthGridColumns: columns, depthGridRows: rows } = visionConfig;
  const cells = Array.from({ length: rows }, (_, row) => {
    const centerRow = ((row + 0.5) * size.height) / rows;
    const level = levelForRow(centerRow, horizonRow, size.height);
    return Array.from({ length: columns }, () => level);
  });
  return { source: "heuristic", columns, rows, cells };
}
