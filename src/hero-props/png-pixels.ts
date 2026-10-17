import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;
const SIGNATURE_BYTES = 8;
const CHUNK_OVERHEAD_BYTES = 12;
const HEADER_DATA_BYTES = 13;

export interface PngPixels {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

interface Layout {
  height: number;
  rowBytes: number;
  step: number;
}

interface Neighbors {
  left: number;
  up: number;
  upLeft: number;
}

function predictor(filter: number, { left, up, upLeft }: Neighbors): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, upLeft);
    default:
      throw new Error(`PNG uses unknown filter ${String(filter)}`);
  }
}

function unfilterRow(
  buffers: { raw: Uint8Array; out: Uint8Array },
  layout: Layout,
  y: number,
): void {
  const { raw, out } = buffers;
  const { rowBytes, step } = layout;
  const filter = raw[y * (rowBytes + 1)] ?? 0;
  const source = y * (rowBytes + 1) + 1;
  const at = (row: number, x: number): number =>
    row < 0 || x < 0 ? 0 : (out[row * rowBytes + x] ?? 0);
  for (let x = 0; x < rowBytes; x++) {
    const predicted = predictor(filter, {
      left: at(y, x - step),
      up: at(y - 1, x),
      upLeft: at(y - 1, x - step),
    });
    out[y * rowBytes + x] = ((raw[source + x] ?? 0) + predicted) & 0xff;
  }
}

function unfilter(raw: Uint8Array, layout: Layout): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(layout.height * layout.rowBytes);
  for (let y = 0; y < layout.height; y++) unfilterRow({ raw, out }, layout, y);
  return out;
}

function parseHeader(body: Buffer): { width: number; height: number; channels: 3 | 4 } {
  if (body.length < HEADER_DATA_BYTES) throw new Error("PNG header chunk is truncated");
  const depth = body[8];
  const colorType = body[9];
  const interlace = body[12];
  const supportedColor = colorType === COLOR_TYPE_RGB || colorType === COLOR_TYPE_RGBA;
  if (depth !== 8 || interlace !== 0 || !supportedColor) {
    throw new Error(
      `Unsupported PNG: bit depth ${String(depth)}, color type ${String(colorType)}, interlace ${String(interlace)}; only 8-bit non-interlaced RGB and RGBA decode`,
    );
  }
  return {
    width: body.readUInt32BE(0),
    height: body.readUInt32BE(4),
    channels: colorType === COLOR_TYPE_RGB ? 3 : 4,
  };
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG; any other PNG type throws. */
export function decodePng(png: Uint8Array): PngPixels {
  const buffer = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (!PNG_SIGNATURE.every((byte, index) => buffer[index] === byte)) {
    throw new Error("Not a PNG: the signature is missing");
  }
  let header: { width: number; height: number; channels: 3 | 4 } | undefined;
  const parts: Buffer[] = [];
  let offset = SIGNATURE_BYTES;
  while (offset + CHUNK_OVERHEAD_BYTES <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    offset += CHUNK_OVERHEAD_BYTES + length;
    if (type === "IHDR") header = parseHeader(body);
    if (type === "IDAT") parts.push(body);
  }
  if (header === undefined) throw new Error("PNG has no header chunk");
  const raw = inflateSync(Buffer.concat(parts));
  const rowBytes = header.width * header.channels;
  if (raw.length < header.height * (rowBytes + 1)) throw new Error("PNG pixel data is truncated");
  return {
    ...header,
    data: unfilter(raw, { height: header.height, rowBytes, step: header.channels }),
  };
}
