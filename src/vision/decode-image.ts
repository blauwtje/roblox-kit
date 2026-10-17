import jpeg from "jpeg-js";
import { inflateSync } from "node:zlib";
import { pngSignature, type RgbaImage } from "./encode-png.ts";

export type { RgbaImage };

interface Palette {
  colors: Buffer;
  alpha: Buffer;
}

type PixelToRgba = (sample: (k: number) => number, palette: Palette) => number[];

const pixelToRgba: Record<number, PixelToRgba> = {
  0: (s) => [s(0), s(0), s(0), 255],
  2: (s) => [s(0), s(1), s(2), 255],
  3: (s, palette) => {
    const at = s(0) * 3;
    if (at + 2 >= palette.colors.length)
      throw new Error("PNG pixel references a missing palette entry.");
    return [
      palette.colors.readUInt8(at),
      palette.colors.readUInt8(at + 1),
      palette.colors.readUInt8(at + 2),
      palette.alpha[s(0)] ?? 255,
    ];
  },
  4: (s) => [s(0), s(0), s(0), s(1)],
  6: (s) => [s(0), s(1), s(2), s(3)],
};

const channelsByColorType: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distances = [
    Math.abs(estimate - left),
    Math.abs(estimate - up),
    Math.abs(estimate - upLeft),
  ];
  const best = Math.min(...distances);
  if (distances[0] === best) return left;
  return distances[1] === best ? up : upLeft;
}

const predictors = [
  () => 0,
  (left: number) => left,
  (_left: number, up: number) => up,
  (left: number, up: number) => (left + up) >> 1,
  paeth,
];

interface Layout {
  height: number;
  stride: number;
  channels: number;
}

function unfilter(raw: Buffer, layout: Layout): Uint8Array {
  const { height, stride, channels } = layout;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const source = y * (stride + 1);
    const predict = predictors[raw.readUInt8(source)];
    if (!predict) throw new Error(`Unknown PNG filter type ${String(raw.readUInt8(source))}.`);
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const hasLeft = x >= channels;
      const left = hasLeft ? (out[row + x - channels] ?? 0) : 0;
      const up = out[row - stride + x] ?? 0;
      const upLeft = hasLeft ? (out[row - stride + x - channels] ?? 0) : 0;
      out[row + x] = ((raw[source + 1 + x] ?? 0) + predict(left, up, upLeft)) & 0xff;
    }
  }
  return out;
}

function readChunks(bytes: Buffer): Map<string, Buffer[]> {
  const chunks = new Map<string, Buffer[]>();
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    chunks.set(type, [
      ...(chunks.get(type) ?? []),
      bytes.subarray(offset + 8, offset + 8 + length),
    ]);
    offset += 12 + length;
  }
  return chunks;
}

function decodePng(bytes: Buffer): RgbaImage {
  const chunks = readChunks(bytes);
  const header = chunks.get("IHDR")?.[0];
  if (!header) throw new Error("PNG has no IHDR chunk.");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const colorType = header.readUInt8(9);
  if (header.readUInt8(8) !== 8)
    throw new Error(`Only 8-bit PNG is supported, got ${String(header.readUInt8(8))}-bit.`);
  if (header.readUInt8(12) !== 0) throw new Error("Interlaced PNG is not supported.");
  const channels = channelsByColorType[colorType];
  const convert = pixelToRgba[colorType];
  if (channels === undefined || !convert)
    throw new Error(`Unsupported PNG color type ${String(colorType)}.`);
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(chunks.get("IDAT") ?? []));
  if (raw.length !== (stride + 1) * height) throw new Error("PNG pixel data has the wrong length.");
  const pixels = unfilter(raw, { height, stride, channels });
  const palette = {
    colors: chunks.get("PLTE")?.[0] ?? Buffer.alloc(0),
    alpha: chunks.get("tRNS")?.[0] ?? Buffer.alloc(0),
  };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.set(
      convert((k) => pixels[i * channels + k] ?? 0, palette),
      i * 4,
    );
  }
  return { width, height, data };
}

export function decodeImage(bytes: Uint8Array): RgbaImage {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  if (buffer.subarray(0, 8).equals(pngSignature)) return decodePng(buffer);
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    const { width, height, data } = jpeg.decode(buffer, { useTArray: true });
    return { width, height, data };
  }
  throw new Error("Image is neither a PNG nor a JPEG.");
}
