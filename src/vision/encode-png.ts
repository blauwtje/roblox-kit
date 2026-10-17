import { crc32, deflateSync } from "node:zlib";

/** RGBA pixels, four bytes per pixel, row by row. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, body: Buffer): Buffer {
  const typeAndBody = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const out = Buffer.alloc(8 + body.length + 4);
  out.writeUInt32BE(body.length, 0);
  typeAndBody.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndBody), 8 + body.length);
  return out;
}

/** Encodes an image as an 8-bit RGBA, non-interlaced PNG. */
export function encodePng(image: RgbaImage): Buffer {
  const { width, height, data } = image;
  if (data.length !== width * height * 4) {
    throw new Error(
      `RGBA data has ${String(data.length)} bytes, expected ${String(width * height * 4)}.`,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    pngSignature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
