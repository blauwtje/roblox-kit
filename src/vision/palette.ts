import { createSeededRandom } from "../shared/seeded-random.ts";
import type { RgbaImage } from "./encode-png.ts";
import {
  type Oklab,
  oklabChroma,
  oklabDistanceSquared,
  oklabHueDegrees,
  oklabToSrgb,
  srgbToOklab,
} from "./oklab.ts";
import { visionConfig } from "./vision-config.ts";

export interface PaletteColor {
  share: number;
  srgbHex: string;
  color3: [number, number, number];
  oklab: Oklab;
  lightness: number;
  chroma: number;
  hueDegrees: number;
  materialGuess: string;
}

export function guessMaterial(color: Oklab): string {
  const chroma = oklabChroma(color);
  if (chroma < visionConfig.greyChroma) {
    if (color.l > 0.85) return "SmoothPlastic";
    if (color.l > 0.55) return "Concrete";
    return color.l > 0.3 ? "Slate" : "Metal";
  }
  const hue = oklabHueDegrees(color);
  if (hue >= 40 && hue < 100 && color.l < 0.65) return "Wood";
  if (hue >= 100 && hue < 170) return "Grass";
  if (hue < 40 || hue >= 340) return color.l < 0.6 ? "Brick" : "Plastic";
  return "Plastic";
}

function item<T>(items: ArrayLike<T>, index: number): T {
  const found = items[index];
  if (found === undefined) throw new Error(`Index ${String(index)} is out of range`);
  return found;
}

function boxAverage(image: RgbaImage, cell: { x: number; y: number }, step: number): number[] {
  const { x, y } = cell;
  const sum = [0, 0, 0, 0];
  let count = 0;
  const endY = Math.min(image.height, (y + 1) * step);
  const endX = Math.min(image.width, (x + 1) * step);
  for (let sy = y * step; sy < endY; sy++) {
    for (let sx = x * step; sx < endX; sx++) {
      const offset = (sy * image.width + sx) * 4;
      sum.forEach((value, c) => (sum[c] = value + item(image.data, offset + c)));
      count++;
    }
  }
  return sum.map((value) => Math.round(value / count));
}

function downsample(image: RgbaImage, limit: number): RgbaImage {
  const step = Math.max(1, Math.ceil(Math.max(image.width, image.height) / limit));
  const width = Math.ceil(image.width / step);
  const height = Math.ceil(image.height / step);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      data.set(boxAverage(image, { x, y }, step), (y * width + x) * 4);
  }
  return { width, height, data };
}

function pickWeighted(weights: number[], total: number, random: () => number): number {
  let target = random() * total;
  for (let i = 0; i < weights.length; i++) {
    target -= item(weights, i);
    if (target <= 0) return i;
  }
  return weights.length - 1;
}

function pickCenters(points: Oklab[], count: number, random: () => number): Oklab[] {
  const first = item(points, Math.floor(random() * points.length));
  const centers = [first];
  const nearest = points.map((point) => oklabDistanceSquared(point, first));
  while (centers.length < count) {
    const total = nearest.reduce((sum, value) => sum + value, 0);
    if (total === 0) break;
    const picked = item(points, pickWeighted(nearest, total, random));
    centers.push(picked);
    points.forEach((point, i) => {
      nearest[i] = Math.min(item(nearest, i), oklabDistanceSquared(point, picked));
    });
  }
  return centers;
}

function assign(points: Oklab[], centers: Oklab[]): number[] {
  return points.map((point) => {
    let best = 0;
    let bestDistance = Infinity;
    centers.forEach((center, index) => {
      const distance = oklabDistanceSquared(point, center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  });
}

function moveCenters(points: Oklab[], labels: number[], centers: Oklab[]): Oklab[] {
  const sums = centers.map(() => ({ l: 0, a: 0, b: 0, count: 0 }));
  points.forEach((point, i) => {
    const sum = item(sums, item(labels, i));
    sum.l += point.l;
    sum.a += point.a;
    sum.b += point.b;
    sum.count++;
  });
  return sums.map((sum, i) =>
    sum.count === 0
      ? item(centers, i)
      : { l: sum.l / sum.count, a: sum.a / sum.count, b: sum.b / sum.count },
  );
}

function toPaletteColor(center: Oklab, share: number): PaletteColor {
  const color3 = oklabToSrgb(center);
  const hex = color3
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return {
    share,
    srgbHex: `#${hex}`,
    color3,
    oklab: center,
    lightness: center.l,
    chroma: oklabChroma(center),
    hueDegrees: oklabHueDegrees(center),
    materialGuess: guessMaterial(center),
  };
}

export function extractPalette(
  image: RgbaImage,
  colorCount: number = visionConfig.paletteColors,
): PaletteColor[] {
  const small = downsample(image, visionConfig.paletteDownsamplePixels);
  const points: Oklab[] = [];
  for (let i = 0; i < small.data.length; i += 4) {
    if (item(small.data, i + 3) < visionConfig.paletteMinAlpha) continue;
    points.push(
      srgbToOklab(
        item(small.data, i) / 255,
        item(small.data, i + 1) / 255,
        item(small.data, i + 2) / 255,
      ),
    );
  }
  if (points.length === 0) return [];

  let centers = pickCenters(points, colorCount, createSeededRandom(visionConfig.paletteSeed));
  let labels = assign(points, centers);
  for (let round = 0; round < visionConfig.paletteIterations; round++) {
    centers = moveCenters(points, labels, centers);
    const next = assign(points, centers);
    const settled = next.every((label, i) => label === labels[i]);
    labels = next;
    if (settled) break;
  }

  const counts = centers.map(() => 0);
  for (const label of labels) counts[label] = item(counts, label) + 1;
  return centers
    .map((center, i) => toPaletteColor(center, item(counts, i) / points.length))
    .filter((color) => color.share >= visionConfig.paletteMinShare)
    .sort((first, second) => second.share - first.share);
}
