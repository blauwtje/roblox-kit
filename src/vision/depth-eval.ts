import { visionConfig } from "./vision-config.ts";

export interface DepthGrid {
  cells: number[][];
  ms: number;
}

export interface DepthEvalFrame {
  truth: number[][];
  heuristic: DepthGrid;
  model?: DepthGrid;
}

export interface DepthArmResult {
  arm: "heuristic" | "model";
  frames: number;
  medianRho: number;
  p10Rho: number;
  winShare: number;
  medianMs: number;
}

export type DepthVerdict = "ship" | "leave-out" | "insufficient-data";

export interface DepthEvalResult {
  arms: DepthArmResult[];
  medianGain: number | null;
  verdict: DepthVerdict;
}

function averageRanks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]?.value === order[start]?.value) end++;
    for (let i = start; i <= end; i++) ranks[order[i]?.index ?? 0] = (start + end) / 2;
    start = end + 1;
  }
  return ranks;
}

/** Spearman rank correlation; 0 when either side is constant. */
export function spearman(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0)
    throw new Error("Spearman needs equal, non-empty lists.");
  const ra = averageRanks(a);
  const rb = averageRanks(b);
  const mean = (a.length - 1) / 2;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = (ra[i] ?? 0) - mean;
    const db = (rb[i] ?? 0) - mean;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va === 0 || vb === 0 ? 0 : cov / Math.sqrt(va * vb);
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = fraction * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (position - low);
}

function resample(grid: number[][], rows: number, columns: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r++) {
    const row = grid[Math.floor(((r + 0.5) * grid.length) / rows)] ?? [];
    for (let c = 0; c < columns; c++) {
      out.push(row[Math.floor(((c + 0.5) * row.length) / columns)] ?? 0);
    }
  }
  return out;
}

/** Spearman rho of a source grid against truth, compared on the source's own grid size. */
export function frameRho(truth: number[][], cells: number[][]): number {
  const rows = cells.length;
  const columns = cells[0]?.length ?? 0;
  return spearman(cells.flat(), resample(truth, rows, columns));
}

function summarize(
  arm: DepthArmResult["arm"],
  scores: { rhos: number[]; ms: number[] },
  wins: number,
): DepthArmResult {
  const { rhos, ms } = scores;
  return {
    arm,
    frames: rhos.length,
    medianRho: percentile(rhos, 0.5),
    p10Rho: percentile(rhos, 0.1),
    winShare: rhos.length === 0 ? 0 : wins / rhos.length,
    medianMs: percentile(ms, 0.5),
  };
}

export function evaluateDepth(frames: DepthEvalFrame[]): DepthEvalResult {
  if (frames.length === 0) return { arms: [], medianGain: null, verdict: "insufficient-data" };
  const heuristicRhos = frames.map((f) => frameRho(f.truth, f.heuristic.cells));
  const heuristicMs = frames.map((f) => f.heuristic.ms);
  const modelFrames = frames.every((f) => f.model !== undefined);
  if (!modelFrames) {
    const arm = summarize("heuristic", { rhos: heuristicRhos, ms: heuristicMs }, 0);
    return { arms: [arm], medianGain: null, verdict: "insufficient-data" };
  }
  const modelRhos = frames.map((f) => frameRho(f.truth, f.model?.cells ?? []));
  const modelMs = frames.map((f) => f.model?.ms ?? 0);
  const gains = modelRhos.map((rho, i) => rho - (heuristicRhos[i] ?? 0));
  const modelWins = gains.filter((gain) => gain > 0).length;
  const heuristicWins = gains.filter((gain) => gain < 0).length;
  const arms = [
    summarize("heuristic", { rhos: heuristicRhos, ms: heuristicMs }, heuristicWins),
    summarize("model", { rhos: modelRhos, ms: modelMs }, modelWins),
  ];
  const medianGain = percentile(gains, 0.5);
  const model = arms[1] as DepthArmResult;
  const enough = frames.length >= visionConfig.depthEvalMinFrames;
  const ships =
    model.medianRho >= visionConfig.depthShipMedianRho &&
    model.p10Rho >= visionConfig.depthShipP10Rho &&
    medianGain >= visionConfig.depthShipMedianGain &&
    model.winShare >= visionConfig.depthShipWinShare &&
    model.medianMs <= visionConfig.depthShipMaxMedianMs;
  if (!enough) return { arms, medianGain, verdict: "insufficient-data" };
  return { arms, medianGain, verdict: ships ? "ship" : "leave-out" };
}
