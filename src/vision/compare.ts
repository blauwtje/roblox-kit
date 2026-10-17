import { frameRho } from "./depth-eval.ts";
import { oklabDistanceSquared } from "./oklab.ts";
import type { PaletteColor } from "./palette.ts";
import type { ImageAnalysis } from "./text-tables.ts";

export type DeltaMetric = "paletteDelta" | "valueDelta" | "depthDelta" | "layoutDelta";

export interface Finding {
  metric: DeltaMetric;
  where: string;
  delta: number;
  detail: string;
}

export interface SuggestedCamera {
  pitchChangeDegrees: number;
  horizonRowReference: number;
  horizonRowCapture: number;
  advice: string;
}

export interface Comparison {
  deltas: { metric: DeltaMetric; delta: number }[];
  findings: Finding[];
  suggestedCamera: SuggestedCamera;
}

const settings = Object.freeze({
  paletteFullDistance: 0.4,
  topFindings: 8,
  missDistance: 1e9,
});

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

function nearest(color: PaletteColor, others: PaletteColor[]): { color: PaletteColor; d: number } {
  let best = { color: others[0] ?? color, d: Infinity };
  for (const other of others) {
    const d = Math.sqrt(oklabDistanceSquared(color.oklab, other.oklab));
    if (d < best.d) best = { color: other, d };
  }
  return best;
}

function paletteFindings(reference: PaletteColor[], capture: PaletteColor[]): Finding[] {
  const side = (from: PaletteColor[], to: PaletteColor[], who: string): Finding[] =>
    from.map((color) => {
      const match = nearest(color, to);
      return {
        metric: "paletteDelta",
        where: `${who} ${color.srgbHex}`,
        delta: clamp01(match.d / settings.paletteFullDistance),
        detail: `share ${(color.share * 100).toFixed(1)}%, nearest other ${match.color.srgbHex}`,
      };
    });
  return [...side(reference, capture, "reference"), ...side(capture, reference, "capture")];
}

function cellFindings(
  metric: "valueDelta" | "layoutDelta",
  pairs: { name: string; reference: number; capture: number }[],
  label: string,
): Finding[] {
  return pairs.map((pair) => ({
    metric,
    where: pair.name,
    delta: clamp01(Math.abs(pair.reference - pair.capture)),
    detail: `${label} ${pair.reference.toFixed(2)} in reference, ${pair.capture.toFixed(2)} in capture`,
  }));
}

function truthRows(truth: number[][]): number[][] {
  return truth.map((row) => row.map((v) => (Number.isFinite(v) ? v : settings.missDistance)));
}

function depthComparison(
  reference: ImageAnalysis,
  capture: ImageAnalysis,
  truth: number[][] | undefined,
): { delta: number; finding: Finding } {
  const against = truth === undefined ? "reference heuristic depth" : "truth distances";
  const rho =
    truth === undefined
      ? frameRho(reference.depth.cells, capture.depth.cells)
      : frameRho(truthRows(truth), capture.depth.cells);
  const delta = clamp01((1 - rho) / 2);
  return {
    delta,
    finding: {
      metric: "depthDelta",
      where: "whole image",
      delta,
      detail: `Spearman rho ${rho.toFixed(2)} of capture depth against ${against}`,
    },
  };
}

function cameraAdvice(reference: ImageAnalysis, capture: ImageAnalysis): SuggestedCamera {
  const pitchChangeDegrees = reference.horizon.pitchDegrees - capture.horizon.pitchDegrees;
  const rowRef = reference.horizon.horizonRow / reference.height;
  const rowCap = capture.horizon.horizonRow / capture.height;
  const direction = pitchChangeDegrees >= 0 ? "up" : "down";
  return {
    pitchChangeDegrees,
    horizonRowReference: reference.horizon.horizonRow,
    horizonRowCapture: capture.horizon.horizonRow,
    advice: `Pitch the camera ${direction} by ${Math.abs(pitchChangeDegrees).toFixed(1)} degrees: the horizon sits at ${(rowRef * 100).toFixed(0)}% of the height in the reference and ${(rowCap * 100).toFixed(0)}% in the capture.`,
  };
}

/** Both analyses must use the same grid. `truth` holds distances in studs, rows of columns. */
export function compareAnalyses(
  reference: ImageAnalysis,
  capture: ImageAnalysis,
  truth?: number[][],
): Comparison {
  const { columns, rows } = reference.grid;
  if (capture.grid.columns !== columns || capture.grid.rows !== rows) {
    throw new Error("The reference and the capture were analyzed with different grids.");
  }
  const pairs = (pick: (cell: ImageAnalysis["value"]["cells"][number]) => number) =>
    reference.value.cells.map((cell, i) => ({
      name: cell.name,
      reference: pick(cell),
      capture: capture.value.cells[i] ? pick(capture.value.cells[i]) : 0,
    }));
  const palette = paletteFindings(reference.palette, capture.palette);
  const value = cellFindings(
    "valueDelta",
    pairs((c) => c.lightness),
    "lightness",
  );
  const edges = cellFindings(
    "layoutDelta",
    pairs((c) => c.edgeDensity),
    "edge density",
  );
  const horizonShift = Math.abs(
    reference.horizon.horizonRow / reference.height - capture.horizon.horizonRow / capture.height,
  );
  const depth = depthComparison(reference, capture, truth);
  const deltas = [
    { metric: "paletteDelta" as const, delta: mean(palette.map((f) => f.delta)) },
    { metric: "valueDelta" as const, delta: mean(value.map((f) => f.delta)) },
    { metric: "depthDelta" as const, delta: depth.delta },
    {
      metric: "layoutDelta" as const,
      delta: clamp01((mean(edges.map((f) => f.delta)) + horizonShift) / 2),
    },
  ].sort((a, b) => b.delta - a.delta);
  const findings = [...palette, ...value, ...edges, depth.finding]
    .sort((a, b) => b.delta - a.delta)
    .slice(0, settings.topFindings);
  return { deltas, findings, suggestedCamera: cameraAdvice(reference, capture) };
}

export function findingsTable(findings: Finding[]): string {
  const rows = findings.map((f, i) =>
    [String(i + 1), f.metric, f.where, f.delta.toFixed(2), f.detail].join(" | "),
  );
  return ["# | metric | where | delta | detail", ...rows].join("\n");
}
