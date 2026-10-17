import type { RgbaImage } from "../vision/encode-png.ts";
import { imagesConfig } from "./images-config.ts";

function neighbors(at: number, width: number, height: number): number[] {
  const x = at % width;
  const y = (at - x) / width;
  const found: number[] = [];
  for (let n = 0; n < 9; n++) {
    const nx = x + (n % 3) - 1;
    const ny = y + Math.floor(n / 3) - 1;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height) found.push(ny * width + nx);
  }
  return found;
}

export type AlphaBleedOptions = { threshold?: number; passes?: number };

/**
 * Dilates the RGB of opaque pixels into pixels under the alpha threshold, one ring per pass,
 * so a pixel takes its nearest opaque neighbor's color. Alpha bytes are never changed, so
 * filtering at the edge of a shape cannot pull in a stray color. Returns a copy.
 */
export function alphaBleed(image: RgbaImage, options: AlphaBleedOptions = {}): RgbaImage {
  const threshold = options.threshold ?? imagesConfig.alphaBleedThreshold;
  const passes = options.passes ?? imagesConfig.alphaBleedPasses;
  const { alphaBleedMinPasses: min, alphaBleedMaxPasses: max } = imagesConfig;
  if (!Number.isInteger(passes) || passes < min || passes > max) {
    throw new Error(`passes must be a whole number from ${String(min)} to ${String(max)}.`);
  }
  const { width, height } = image;
  const data = Uint8Array.from(image.data);
  const filled = new Uint8Array(width * height);
  let frontier: number[] = [];
  for (let at = 0; at < filled.length; at++) {
    if ((data[at * 4 + 3] ?? 0) >= threshold) {
      filled[at] = 1;
      frontier.push(at);
    }
  }
  const claim = (from: number, to: number): boolean => {
    if (filled[to]) return false;
    filled[to] = 1;
    data.copyWithin(to * 4, from * 4, from * 4 + 3);
    return true;
  };
  for (let pass = 0; pass < passes && frontier.length > 0; pass++) {
    const spread = (from: number) => neighbors(from, width, height).filter((to) => claim(from, to));
    frontier = frontier.flatMap(spread);
  }
  return { width, height, data };
}
