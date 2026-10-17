import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import jpeg from "jpeg-js";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { createAnalyzeImageTool } from "./analyze-image-tool.ts";
import { encodePng, pngSignature, type RgbaImage } from "./encode-png.ts";

function pixelColor(x: number, y: number, size: { width: number; height: number }): number[] {
  if (y >= size.height / 2) return [40, 40, 50];
  return x < size.width / 2 ? [200, 60, 50] : [230, 230, 220];
}

function scene(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = pixelColor(x, y, { width, height });
      data.set([...color, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

async function run(
  images: { path: string; label?: string }[],
  options: { grid?: { columns: number; rows: number }; paletteSize?: number } = {},
) {
  const projectDir = await mkdtemp(join(tmpdir(), "analyze-image-"));
  const tool = createAnalyzeImageTool(projectDir);
  const input = tool.inputSchema.parse({ images, ...options });
  const result = await tool.handler(input, { studio: new FakeStudioConnection([]) });
  return { projectDir, output: tool.outputSchema.parse(result.structuredContent) };
}

async function writeScene(width: number, height: number, kind: "png" | "jpg"): Promise<string> {
  const image = scene(width, height);
  const path = join(await mkdtemp(join(tmpdir(), "analyze-src-")), `scene.${kind}`);
  await writeFile(
    path,
    kind === "png"
      ? encodePng(image)
      : jpeg.encode({ ...image, data: Buffer.from(image.data) }, 90).data,
  );
  return path;
}

await test("a PNG and a JPEG each give every table and write their four files", async () => {
  for (const kind of ["png", "jpg"] as const) {
    const { output, projectDir } = await run([{ path: await writeScene(160, 120, kind) }]);
    const [first] = output.images;
    assert.ok(first);
    assert.ok(
      first.marksPath.startsWith(join(projectDir, ".roblox-kit", "vision", output.analysisId)),
    );
    for (const heading of [
      "## Palette",
      "## Value structure",
      "## Edge density",
      "## Regions",
      "## Horizon",
      "## Depth",
    ]) {
      assert.ok(first.tables.includes(heading), `${kind} ${heading}`);
    }
    assert.match(first.tables, /Color3\.fromRGB/);
    assert.deepEqual((await readFile(first.marksPath)).subarray(0, 8), pngSignature);
    assert.ok((await stat(first.palettePath)).size > 0);
    const saved = JSON.parse(await readFile(first.analysisPath, "utf8")) as { palette: unknown[] };
    assert.ok(saved.palette.length >= 2);
    assert.equal(await readFile(first.summaryPath, "utf8"), first.tables);
  }
});

await test("grid and paletteSize shape the tables, and a label names the image", async () => {
  const { output } = await run([{ path: await writeScene(80, 60, "png"), label: "ref" }], {
    grid: { columns: 4, rows: 3 },
    paletteSize: 3,
  });
  const [first] = output.images;
  assert.ok(first);
  assert.equal(first.label, "ref");
  const edgeSection = first.tables.split("## Edge density\n")[1]?.split("\n## ")[0] ?? "";
  assert.equal(edgeSection.trim().split("\n").length, 3);
  const palette = first.tables.split("## Palette\n")[1]?.split("\n## ")[0] ?? "";
  assert.ok(palette.trim().split("\n").length - 1 <= 3);
});

await test("one to four images are accepted, and zero, five or a text file are not", async () => {
  const path = await writeScene(40, 30, "png");
  const { output } = await run([{ path }, { path }]);
  assert.equal(output.images.length, 2);
  assert.notEqual(output.images[0]?.marksPath, output.images[1]?.marksPath);
  const tool = createAnalyzeImageTool(undefined);
  assert.equal(tool.inputSchema.safeParse({ images: [] }).success, false);
  assert.equal(tool.inputSchema.safeParse({ images: Array(5).fill({ path }) }).success, false);
  const text = join(await mkdtemp(join(tmpdir(), "analyze-src-")), "a.png");
  await writeFile(text, "not an image");
  await assert.rejects(run([{ path: text }]));
});

await test("analysing a 1456 by 1030 image takes under 500 ms", async () => {
  const path = await writeScene(1456, 1030, "png");
  const start = performance.now();
  await run([{ path }]);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)} ms`);
});
