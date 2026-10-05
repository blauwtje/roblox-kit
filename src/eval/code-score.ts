import type { SceneStatSample } from "../map/check-map-tool.ts";

/** Points a benchmark loses per issue, of any kind that check_map counts. */
const POINTS_PER_ISSUE = 10;
/** Most points the issues can take; the rest is left for the performance budget. */
const MAX_ISSUE_PENALTY = 80;
/** Points lost when the worst zone camera is at least twice over a budget limit. */
const MAX_PERFORMANCE_PENALTY = 20;
const PERFECT_SCORE = 100;

export interface CodeScoreInput {
  /** Exact issues per kind, as check_map's `counts`. */
  counts: Record<string, number>;
  /** One sample per zone camera, as check_map's `sceneStats`; empty when nothing was sampled. */
  sceneStats: SceneStatSample[];
  budget: { maxDrawCalls: number; maxTriangles: number };
}

/** How far the highest value is over its limit, as a fraction of the limit; 0 at or under it. */
function overageOf(highest: number, limit: number): number {
  return Math.max(0, highest / limit - 1);
}

/**
 * The code-based benchmark score, 0 to 100: 100 minus ten points per issue (at most 80) minus up to 20
 * points for the worst zone camera's draw calls or triangles over the budget, in proportion to the overage.
 */
export function codeScoreOf(input: CodeScoreInput): number {
  const issueCount = Object.values(input.counts).reduce((total, count) => total + count, 0);
  const issuePenalty = Math.min(MAX_ISSUE_PENALTY, issueCount * POINTS_PER_ISSUE);

  const highestDrawCalls = Math.max(0, ...input.sceneStats.map((sample) => sample.drawCalls));
  const highestTriangles = Math.max(0, ...input.sceneStats.map((sample) => sample.triangles));
  const overage = Math.max(
    overageOf(highestDrawCalls, input.budget.maxDrawCalls),
    overageOf(highestTriangles, input.budget.maxTriangles),
  );
  const performancePenalty = Math.min(MAX_PERFORMANCE_PENALTY, overage * MAX_PERFORMANCE_PENALTY);

  return Math.round(PERFECT_SCORE - issuePenalty - performancePenalty);
}

/** Luminance bins (0-255, equal width) of an image's histogram. */
export const LUMINANCE_BINS = 8;
/** Channel bits kept when counting the most common color, so a smooth gradient still counts as one color. */
const COLOR_BITS = 4;
/** Luminance difference (0-255) between neighbouring pixels at which a pixel counts as an edge. */
const EDGE_THRESHOLD = 6;

export interface ImageStats {
  /** Share of pixels in the most common color, each channel cut to four bits. */
  flatColorShare: number;
  /** Share of pixels per luminance bin, darkest first; sums to 1. */
  luminanceHistogram: number[];
  /** Share of pixels whose luminance differs from the pixel to the right or below by at least the edge threshold. */
  edgeDensity: number;
}

function luminanceAt(data: Uint8Array, pixel: number): number {
  const offset = pixel * 4;
  return (
    0.2126 * (data[offset] ?? 0) +
    0.7152 * (data[offset + 1] ?? 0) +
    0.0722 * (data[offset + 2] ?? 0)
  );
}

/** The flat-color share, luminance histogram and edge density of RGBA pixels (four bytes each, as jpeg-js decodes them). */
export function imageStatsOf(image: {
  width: number;
  height: number;
  data: Uint8Array;
}): ImageStats {
  const { width, height, data } = image;
  const pixelCount = width * height;
  if (pixelCount === 0) {
    return {
      flatColorShare: 1,
      luminanceHistogram: Array<number>(LUMINANCE_BINS).fill(0),
      edgeDensity: 0,
    };
  }
  const colorCounts = new Map<number, number>();
  const histogram = Array<number>(LUMINANCE_BINS).fill(0);
  const shift = 8 - COLOR_BITS;
  let edgePixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const color =
        (((data[offset] ?? 0) >> shift) << (COLOR_BITS * 2)) |
        (((data[offset + 1] ?? 0) >> shift) << COLOR_BITS) |
        ((data[offset + 2] ?? 0) >> shift);
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
      const luminance = luminanceAt(data, pixel);
      const bin = Math.min(LUMINANCE_BINS - 1, Math.floor((luminance / 256) * LUMINANCE_BINS));
      histogram[bin] = (histogram[bin] ?? 0) + 1;
      const right = x + 1 < width ? Math.abs(luminance - luminanceAt(data, pixel + 1)) : 0;
      const below = y + 1 < height ? Math.abs(luminance - luminanceAt(data, pixel + width)) : 0;
      if (Math.max(right, below) >= EDGE_THRESHOLD) {
        edgePixels += 1;
      }
    }
  }
  return {
    flatColorShare: Math.max(...colorCounts.values()) / pixelCount,
    luminanceHistogram: histogram.map((count) => count / pixelCount),
    edgeDensity: edgePixels / pixelCount,
  };
}
