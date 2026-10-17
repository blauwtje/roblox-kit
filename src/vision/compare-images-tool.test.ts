import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { createAnalyzeImageTool } from "./analyze-image-tool.ts";
import { createCompareImagesTool } from "./compare-images-tool.ts";
import { encodePng, pngSignature, type RgbaImage } from "./encode-png.ts";

function fill(size: number[], top: number[], bottom: number[]): RgbaImage {
  const [width = 1, height = 1] = size;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.set([...(i < (width * height) / 2 ? top : bottom), 255], i * 4);
  }
  return { width, height, data };
}

async function write(dir: string, name: string, image: RgbaImage): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, encodePng(image));
  return path;
}

const context = { studio: new FakeStudioConnection([]) };

await test("compares two paths, an analysisId and a truth file into ranked deltas and a PNG", async () => {
  const dir = await mkdtemp(join(tmpdir(), "compare-images-"));
  const reference = await write(dir, "ref.png", fill([64, 48], [220, 220, 210], [60, 50, 40]));
  const capture = await write(dir, "cap.png", fill([80, 48], [30, 30, 80], [200, 40, 40]));
  const analyze = createAnalyzeImageTool(dir);
  const analyzed = analyze.outputSchema.parse(
    (await analyze.handler(analyze.inputSchema.parse({ images: [{ path: capture }] }), context))
      .structuredContent,
  );
  const truth = join(dir, "truth.json");
  const rows = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, () => (r === 0 ? null : { distanceStuds: 100 - r * 10 })),
  );
  await writeFile(truth, JSON.stringify({ shots: [{ rows }] }));

  const tool = createCompareImagesTool(dir);
  const input = tool.inputSchema.parse({
    reference,
    capture: analyzed.analysisId,
    truth: { path: truth },
  });
  const output = tool.outputSchema.parse((await tool.handler(input, context)).structuredContent);

  assert.deepEqual(output.deltas.map((d) => d.metric).sort(), [
    "depthDelta",
    "layoutDelta",
    "paletteDelta",
    "valueDelta",
  ]);
  const values = output.deltas.map((d) => d.delta);
  assert.deepEqual(
    values,
    [...values].sort((a, b) => b - a),
  );
  assert.ok(output.table.split("\n").length <= 9);
  assert.ok(output.suggestedCamera.advice.length > 0);
  assert.deepEqual((await readFile(output.sideBySidePath)).subarray(0, 8), pngSignature);
});

await test("an analysisId that does not exist is an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "compare-images-"));
  const tool = createCompareImagesTool(dir);
  const input = tool.inputSchema.parse({ reference: "deadbeef", capture: "deadbeef" });
  await assert.rejects(tool.handler(input, context));
});
