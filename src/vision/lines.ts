import { visionConfig } from "./vision-config.ts";

export interface HorizonEstimate {
  horizonRow: number;
  pitchDegrees: number;
  confidence: number;
}

interface Size {
  width: number;
  height: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function crossingRow(
  gradient: [number, number],
  at: { x: number; y: number },
  centerX: number,
): number | null {
  const [gx, gy] = gradient;
  const { x, y } = at;
  const dx = -gy;
  const dy = gx;
  const slant = Math.atan2(Math.abs(dy), Math.abs(dx));
  if (slant < toRadians(visionConfig.lineMinSlantDegrees)) return null;
  if (slant > toRadians(visionConfig.lineMaxSlantDegrees)) return null;
  return y + ((centerX - x) / dx) * dy;
}

function voteHistogram(lightness: Float32Array, size: Size): Float64Array {
  const { width, height } = size;
  const bins = visionConfig.horizonVoteBins;
  const votes = new Float64Array(bins);
  const at = (x: number, y: number): number => lightness[y * width + x] ?? 0;
  const inner = (width - 2) * (height - 2);
  for (let i = 0; i < inner; i++) {
    const x = 1 + (i % (width - 2));
    const y = 1 + Math.floor(i / (width - 2));
    const gx = (at(x + 1, y) - at(x - 1, y)) / 2;
    const gy = (at(x, y + 1) - at(x, y - 1)) / 2;
    const magnitude = Math.hypot(gx, gy);
    if (magnitude <= visionConfig.edgeThreshold) continue;
    const row = crossingRow([gx, gy], { x, y }, (width - 1) / 2);
    if (row === null || row < 0 || row >= height) continue;
    const bin = Math.min(bins - 1, Math.floor((row / height) * bins));
    votes[bin] = (votes[bin] ?? 0) + magnitude;
  }
  return votes;
}

function peakWindow(votes: Float64Array): { start: number; share: number } {
  const span = visionConfig.horizonPeakBins;
  const total = votes.reduce((sum, value) => sum + value, 0);
  let best = { start: 0, weight: -1 };
  for (let start = 0; start + span <= votes.length; start++) {
    const weight = votes.slice(start, start + span).reduce((sum, value) => sum + value, 0);
    if (weight > best.weight) best = { start, weight };
  }
  return { start: best.start, share: total === 0 ? 0 : best.weight / total };
}

export function estimateHorizon(lightness: Float32Array, size: Size): HorizonEstimate {
  const votes = voteHistogram(lightness, size);
  const { start, share } = peakWindow(votes);
  const center = size.height / 2;
  if (share === 0) return { horizonRow: center, pitchDegrees: 0, confidence: 0 };
  const binHeight = size.height / visionConfig.horizonVoteBins;
  const weights = Array.from(votes.slice(start, start + visionConfig.horizonPeakBins));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const offset = weights.reduce((sum, value, i) => sum + value * (i + 0.5), 0) / weightSum;
  const horizonRow = (start + offset) * binHeight;
  const focal = center / Math.tan(toRadians(visionConfig.verticalFovDegrees / 2));
  const pitchDegrees = (Math.atan((center - horizonRow) / focal) * 180) / Math.PI;
  return { horizonRow, pitchDegrees, confidence: share };
}
