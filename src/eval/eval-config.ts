export const evalConfig = Object.freeze({
  qualityReviewersPerRoom: 3,
  qualityReviewTimeoutMs: 420_000,
  maxJudgeRounds: 3,
  judgeEarlyRounds: [
    { images: 4, longEdge: 1000 },
    { images: 6, longEdge: 1280 },
  ],
  judgeLogFile: ".roblox-kit/judge-log.jsonl",
  gateMinCodeScore: 80,
  gateMaxFlatColorShare: 0.9,
  gateMaxExtremeLuminanceShare: 0.99,
  gateMinEdgeDensity: 0.0002,
  visualPassScore: 7,
});
