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
