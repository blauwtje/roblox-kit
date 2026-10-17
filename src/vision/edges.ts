import { visionConfig } from "./vision-config.ts";

export interface CellRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface EdgeStats {
  edgeDensity: number;
  edgeAngle: number | null;
}

function sobel(at: (x: number, y: number) => number, x: number, y: number): [number, number] {
  const gx =
    at(x + 1, y - 1) +
    2 * at(x + 1, y) +
    at(x + 1, y + 1) -
    (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
  const gy =
    at(x - 1, y + 1) +
    2 * at(x, y + 1) +
    at(x + 1, y + 1) -
    (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
  return [gx, gy];
}

export function regionEdgeStats(
  lightness: Float32Array,
  size: { width: number; height: number },
  region: CellRegion,
): EdgeStats {
  const { width, height } = size;
  const at = (x: number, y: number): number =>
    lightness[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))] ??
    0;
  const regionWidth = region.right - region.left;
  const area = regionWidth * (region.bottom - region.top);
  let edgePixels = 0;
  let sumCos = 0;
  let sumSin = 0;
  for (let i = 0; i < area; i++) {
    const [gx, gy] = sobel(
      at,
      region.left + (i % regionWidth),
      region.top + Math.floor(i / regionWidth),
    );
    const magnitude = Math.hypot(gx, gy) / 4;
    if (magnitude <= visionConfig.edgeThreshold) continue;
    edgePixels++;
    const doubled = 2 * (Math.atan2(gy, gx) + Math.PI / 2);
    sumCos += magnitude * Math.cos(doubled);
    sumSin += magnitude * Math.sin(doubled);
  }
  if (edgePixels === 0) return { edgeDensity: 0, edgeAngle: null };
  const degrees = (Math.atan2(sumSin, sumCos) * 90) / Math.PI;
  return { edgeDensity: edgePixels / area, edgeAngle: (degrees + 180) % 180 };
}
