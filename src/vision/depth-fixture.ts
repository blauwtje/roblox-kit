import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import jpeg from "jpeg-js";
import type { RgbaImage } from "./decode-image.ts";

export const depthFixtureWidth = 518;
export const depthFixtureColumns = 32;
export const depthFixtureRows = 18;
const jpegQuality = 90;
export const depthMissStuds = 2000;

export interface DepthTruthCell {
  distanceStuds: number;
}

export function depthFixtureName(benchmark: string, zone: string, view: string): string {
  return `${benchmark}-${zone}-${view}`;
}

function boxAverage(image: RgbaImage, x: number[], y: number[]): number[] {
  const sum = [0, 0, 0, 0];
  for (let sy = y[0] ?? 0; sy < (y[1] ?? 0); sy++) {
    for (let sx = x[0] ?? 0; sx < (x[1] ?? 0); sx++) {
      const at = (sy * image.width + sx) * 4;
      sum.forEach((total, c) => (sum[c] = total + (image.data[at + c] ?? 0)));
    }
  }
  const count = ((y[1] ?? 0) - (y[0] ?? 0)) * ((x[1] ?? 0) - (x[0] ?? 0));
  return sum.map((total) => Math.round(total / count));
}

function span(index: number, from: number, to: number): number[] {
  const start = Math.floor((index * from) / to);
  return [start, Math.max(start + 1, Math.floor(((index + 1) * from) / to))];
}

export function resizeToWidth(image: RgbaImage, width: number): RgbaImage {
  if (image.width <= width) return image;
  const height = Math.max(1, Math.round((image.height * width) / image.width));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(
        boxAverage(image, span(x, image.width, width), span(y, image.height, height)),
        (y * width + x) * 4,
      );
    }
  }
  return { width, height, data };
}

export interface DepthFixtureInput {
  root: string;
  name: string;
  image: RgbaImage;
  rows: (DepthTruthCell | null)[][];
}

export async function writeDepthFixture(input: DepthFixtureInput): Promise<string> {
  const { rows } = input;
  if (rows.length !== depthFixtureRows || rows.some((row) => row.length !== depthFixtureColumns)) {
    throw new Error(
      `${input.name}: truth grid is ${String(rows[0]?.length ?? 0)} by ${String(rows.length)}, not ${String(depthFixtureColumns)} by ${String(depthFixtureRows)}.`,
    );
  }
  const small = resizeToWidth(input.image, depthFixtureWidth);
  const folder = join(input.root, input.name);
  await mkdir(folder, { recursive: true });
  const encoded = jpeg.encode(
    { width: small.width, height: small.height, data: Buffer.from(small.data) },
    jpegQuality,
  );
  await writeFile(join(folder, "image.jpg"), encoded.data);
  const cells = rows.map((row) => row.map((cell) => cell?.distanceStuds ?? depthMissStuds));
  await writeFile(join(folder, "truth.json"), JSON.stringify({ cells }));
  return folder;
}
