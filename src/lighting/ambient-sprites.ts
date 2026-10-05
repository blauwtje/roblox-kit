import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { heroAssetsFile, readHeroAssets } from "../hero-props/hero-asset-store.ts";
import { recipeHash } from "../hero-props/recipe-hash.ts";
import { spriteNames, type SpriteName } from "../style/preset-schema.ts";

/**
 * The particle and beam sprites of ambient effects, drawn here pixel by pixel: white RGBA with the shape in the
 * alpha channel, so an emitter's Color tints it. Nothing is read from outside the repository; the source of this
 * file is part of every sprite's hash, so a drawing change makes new uploads.
 */
export const spriteSizePixels = 64;

/** A deterministic value in [0, 1) for an integer lattice point. */
function latticeNoise(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothly interpolated lattice noise at a fractional point. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top =
    latticeNoise(x0, y0, seed) + (latticeNoise(x0 + 1, y0, seed) - latticeNoise(x0, y0, seed)) * sx;
  const bottom =
    latticeNoise(x0, y0 + 1, seed) +
    (latticeNoise(x0 + 1, y0 + 1, seed) - latticeNoise(x0, y0 + 1, seed)) * sx;
  return top + (bottom - top) * sy;
}

/** The alpha in [0, 1] of `sprite` at (u, v), both in [-1, 1] from the sprite's center. */
function alphaAt(sprite: SpriteName, u: number, v: number): number {
  const radius = Math.hypot(u, v);
  const falloff = Math.max(0, 1 - radius);
  switch (sprite) {
    case "dust":
      return falloff ** 2;
    case "steam": {
      const cloud = 0.6 * valueNoise(u * 3 + 3, v * 3 + 3, 7) + 0.4 * valueNoise(u * 7, v * 7, 11);
      return Math.min(1, falloff ** 1.5 * (0.5 + cloud));
    }
    case "spark": {
      const core = Math.max(0, 1 - radius * 4);
      const streak = Math.max(0, 1 - Math.abs(v) * 12) * Math.max(0, 1 - Math.abs(u));
      const cross = Math.max(0, 1 - Math.abs(u) * 12) * Math.max(0, 1 - Math.abs(v));
      return Math.min(1, core + 0.8 * streak + 0.5 * cross);
    }
    case "glow":
      // A beam stretches the sprite along u, so the glow fades across v only, softened at the ends.
      return Math.exp(-((v * 2.2) ** 2)) * Math.min(1, (1 - Math.abs(u)) * 4);
  }
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** The PNG of `sprite`: 8-bit RGBA, `spriteSizePixels` square. */
export function drawSprite(sprite: SpriteName): Buffer {
  const size = spriteSizePixels;
  const rows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    rows[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      const offset = rowStart + 1 + x * 4;
      rows.fill(255, offset, offset + 3);
      rows[offset + 3] = Math.round(255 * Math.max(0, Math.min(1, alphaAt(sprite, u, v))));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The record kind of a sprite, beside the hero prop kinds in `hero-assets.json`. */
export function spriteKind(sprite: SpriteName): string {
  return `sprite-${sprite}`;
}

/** The hash of each sprite: its name and size, hashed with this file's source. */
export async function spriteHashes(): Promise<Record<SpriteName, string>> {
  const source = await readFile(new URL(import.meta.url), "utf8");
  const entries = spriteNames.map(
    (sprite) => [sprite, recipeHash({ sprite, sizePixels: spriteSizePixels }, source)] as const,
  );
  return Object.fromEntries(entries) as Record<SpriteName, string>;
}

/** The recorded Image ContentId (rbxassetid://<id>) of each sprite that has one. */
export async function recordedSprites(
  file: URL = heroAssetsFile,
): Promise<Partial<Record<SpriteName, string>>> {
  const hashes = await spriteHashes();
  const assets = await readHeroAssets(file);
  const textures: Partial<Record<SpriteName, string>> = {};
  for (const sprite of spriteNames) {
    const asset = assets[hashes[sprite]];
    if (asset?.kind === spriteKind(sprite)) textures[sprite] = `rbxassetid://${asset.assetId}`;
  }
  return textures;
}
