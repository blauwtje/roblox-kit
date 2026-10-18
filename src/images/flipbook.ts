import type { RgbaImage } from "../vision/encode-png.ts";
import { alphaBleed } from "./alpha-bleed.ts";

const sideByLayout = { Grid2x2: 2, Grid4x4: 4, Grid8x8: 8 } as const;
const minSheet = 8;
const maxSheet = 1024;

export type FlipbookLayout = keyof typeof sideByLayout;

/** Places equal-size square frames row-major into one square power-of-two sheet and bleeds it once. */
export function composeFlipbook(frames: readonly RgbaImage[], layout: FlipbookLayout): RgbaImage {
  const side = sideByLayout[layout] as number | undefined;
  if (side === undefined) {
    throw new Error(
      `Unknown layout ${layout as string}; use ${Object.keys(sideByLayout).join(", ")}.`,
    );
  }
  const counts = Object.values(sideByLayout).map((s) => s * s);
  if (frames.length !== side * side) {
    throw new Error(
      `${layout} needs ${String(side * side)} frames, got ${String(frames.length)}; allowed counts are ${counts.join(", ")}.`,
    );
  }
  const size = frames[0]?.width ?? 0;
  const sheet = size * side;
  const power = sheet > 0 && (sheet & (sheet - 1)) === 0;
  if (!power || sheet < minSheet || sheet > maxSheet) {
    throw new Error(
      `${layout} sheet must be a power of two from ${String(minSheet)} to ${String(maxSheet)} px, got ${String(sheet)}.`,
    );
  }
  if (frames.some((f) => f.width !== size || f.height !== size)) {
    throw new Error(
      `All frames must be ${String(size)}x${String(size)} px; allowed counts are ${counts.join(", ")}.`,
    );
  }
  const data = new Uint8Array(sheet * sheet * 4);
  frames.forEach((frame, i) => {
    const left = (i % side) * size;
    const top = Math.floor(i / side) * size;
    for (let y = 0; y < size; y++) {
      const row = frame.data.subarray(y * size * 4, (y + 1) * size * 4);
      data.set(row, ((top + y) * sheet + left) * 4);
    }
  });
  return alphaBleed({ width: sheet, height: sheet, data });
}
