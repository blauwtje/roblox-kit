import assert from "node:assert/strict";
import { test } from "node:test";
import jpeg from "jpeg-js";
import { deflateSync } from "node:zlib";
import { decodeImage } from "./decode-image.ts";
import { pngSignature } from "./encode-png.ts";

interface PngSpec {
  width: number;
  height: number;
  colorType: number;
  rows: number[][];
  extra?: Buffer[];
}

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  body.copy(out, 8);
  return out;
}

function rawPng(spec: PngSpec): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(spec.width, 0);
  header.writeUInt32BE(spec.height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(spec.colorType, 9);
  return Buffer.concat([
    pngSignature,
    chunk("IHDR", header),
    ...(spec.extra ?? []),
    chunk("IDAT", deflateSync(Buffer.from(spec.rows.flat()))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function pixelsOf(spec: PngSpec): number[] {
  return [...decodeImage(rawPng(spec)).data];
}

await test("decodeImage expands gray, gray+alpha and RGB PNG to RGBA", () => {
  assert.deepEqual(pixelsOf({ width: 1, height: 1, colorType: 0, rows: [[0, 9]] }), [9, 9, 9, 255]);
  assert.deepEqual(
    pixelsOf({ width: 1, height: 1, colorType: 4, rows: [[0, 9, 7]] }),
    [9, 9, 9, 7],
  );
  assert.deepEqual(
    pixelsOf({ width: 1, height: 1, colorType: 2, rows: [[0, 1, 2, 3]] }),
    [1, 2, 3, 255],
  );
});

await test("decodeImage reverses none, sub, up, average and paeth filters", () => {
  const rows = [
    [0, 10, 20, 30, 15, 25, 35],
    [1, 10, 20, 30, 5, 5, 5],
    [2, 0, 0, 0, 0, 0, 0],
    [3, 5, 10, 15, 3, 3, 3],
    [4, 0, 0, 0, 0, 0, 0],
  ];
  const pixels = pixelsOf({ width: 2, height: 5, colorType: 2, rows });
  for (let y = 0; y < 5; y++) {
    const row = pixels.slice(y * 8, y * 8 + 8);
    assert.deepEqual(row, [10, 20, 30, 255, 15, 25, 35, 255], `row ${String(y)}`);
  }
});

await test("decodeImage maps palette PNG through PLTE and tRNS", () => {
  const extra = [
    chunk("PLTE", Buffer.from([255, 0, 0, 0, 255, 0])),
    chunk("tRNS", Buffer.from([255, 128])),
  ];
  const pixels = pixelsOf({ width: 2, height: 1, colorType: 3, rows: [[0, 1, 0]], extra });
  assert.deepEqual(pixels, [0, 255, 0, 128, 255, 0, 0, 255]);
});

await test("decodeImage decodes a JPEG to RGBA with its size", () => {
  const data = new Uint8Array(8 * 8 * 4).fill(255);
  const decoded = decodeImage(jpeg.encode({ width: 8, height: 8, data }, 100).data);
  assert.equal(decoded.width, 8);
  assert.equal(decoded.height, 8);
  assert.equal(decoded.data.length, 256);
  assert.ok((decoded.data[0] ?? 0) > 240);
});

await test("decodeImage rejects interlaced, 16-bit and unknown inputs", () => {
  const spec = { width: 1, height: 1, colorType: 0, rows: [[0, 1]] };
  const interlaced = rawPng(spec);
  interlaced.writeUInt8(1, 8 + 8 + 12);
  assert.throws(() => decodeImage(interlaced), /Interlaced/);
  const sixteen = rawPng(spec);
  sixteen.writeUInt8(16, 8 + 8 + 8);
  assert.throws(() => decodeImage(sixteen), /8-bit/);
  assert.throws(() => decodeImage(Uint8Array.from([1, 2, 3])), /neither/);
});
