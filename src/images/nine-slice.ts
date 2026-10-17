import { imagesConfig } from "./images-config.ts";

export interface SliceCenter {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface NineSliceManifest {
  width: number;
  height: number;
  sliceCenter: SliceCenter;
  sliceScale: 0.5;
}

function assertSide(side: number): void {
  if (!Number.isInteger(side) || side <= 0) {
    throw new Error(`Image size must be positive whole pixels, got ${String(side)}.`);
  }
  if (side > imagesConfig.maxImagePixels) {
    throw new Error(
      `Image edge ${String(side)} exceeds ${String(imagesConfig.maxImagePixels)} px.`,
    );
  }
}

/** Manifest for art drawn at twice its display size, so a slice scales by 0.5. */
export function nineSliceManifest(
  width: number,
  height: number,
  sliceCenter: SliceCenter,
): NineSliceManifest {
  assertSide(width);
  assertSide(height);
  const { x0, y0, x1, y1 } = sliceCenter;
  if (x0 < 0 || y0 < 0 || x1 > width || y1 > height) {
    throw new Error("Slice center lies outside the image.");
  }
  if (x1 <= x0 || y1 <= y0) {
    throw new Error("Slice center needs a middle of at least one pixel.");
  }
  return { width, height, sliceCenter: { x0, y0, x1, y1 }, sliceScale: 0.5 };
}
