import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { decodePng } from "./png-pixels.ts";

function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  body.copy(out, 8);
  return out;
}

interface PngOptions {
  width: number;
  height: number;
  rows: number[][];
  colorType: number;
  depth?: number;
}

function png(options: PngOptions): Uint8Array {
  const { width, height, rows, colorType, depth = 8 } = options;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = colorType;
  const raw = Buffer.from(rows.flat());
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const expected = [10, 20, 30, 40, 50, 60, 15, 25, 35, 70, 80, 90];

const rows: { name: string; filtered: number[][] }[] = [
  {
    name: "none",
    filtered: [
      [0, 10, 20, 30, 40, 50, 60],
      [0, 15, 25, 35, 70, 80, 90],
    ],
  },
  {
    name: "sub",
    filtered: [
      [1, 10, 20, 30, 30, 30, 30],
      [1, 15, 25, 35, 55, 55, 55],
    ],
  },
  {
    name: "up",
    filtered: [
      [0, 10, 20, 30, 40, 50, 60],
      [2, 5, 5, 5, 30, 30, 30],
    ],
  },
  {
    name: "average",
    filtered: [
      [3, 10, 20, 30, 35, 40, 45],
      [3, 10, 15, 20, 43, 43, 43],
    ],
  },
  {
    name: "paeth",
    filtered: [
      [4, 10, 20, 30, 30, 30, 30],
      [4, 5, 5, 5, 30, 30, 30],
    ],
  },
];

for (const { name, filtered } of rows) {
  await test(`decodePng undoes the ${name} filter on RGB`, () => {
    const decoded = decodePng(png({ width: 2, height: 2, rows: filtered, colorType: 2 }));
    assert.equal(decoded.channels, 3);
    assert.deepEqual([...decoded.data], expected);
  });
}

await test("decodePng reads RGBA", () => {
  const decoded = decodePng(
    png({
      width: 1,
      height: 2,
      colorType: 6,
      rows: [
        [0, 1, 2, 3, 4],
        [2, 1, 1, 1, 1],
      ],
    }),
  );
  assert.deepEqual([decoded.width, decoded.height, decoded.channels], [1, 2, 4]);
  assert.deepEqual([...decoded.data], [1, 2, 3, 4, 2, 3, 4, 5]);
});

await test("decodePng throws on unsupported PNG types and non-PNG bytes", () => {
  assert.throws(
    () => decodePng(png({ width: 1, height: 1, rows: [[0, 5]], colorType: 0 })),
    /Unsupported PNG/,
  );
  assert.throws(
    () => decodePng(png({ width: 1, height: 1, rows: [[0, 1, 2, 3]], colorType: 2, depth: 16 })),
    /Unsupported PNG/,
  );
  assert.throws(() => decodePng(new Uint8Array(16)), /signature/);
});
