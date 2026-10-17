import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeImage } from "./decode-image.ts";
import { encodePng } from "./encode-png.ts";

await test("encodePng output decodes back to the same pixels", () => {
  const data = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => (i * 37) % 256);
  const decoded = decodeImage(encodePng({ width: 3, height: 2, data }));
  assert.deepEqual(decoded, { width: 3, height: 2, data });
});

await test("encodePng rejects data that does not match the size", () => {
  assert.throws(() => encodePng({ width: 2, height: 2, data: new Uint8Array(3) }), /expected 16/);
});
