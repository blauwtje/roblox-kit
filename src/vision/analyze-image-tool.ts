import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { decodeImage } from "./decode-image.ts";
import { encodePng, type RgbaImage } from "./encode-png.ts";
import { drawGridMarks } from "./grid-marks.ts";
import { heuristicDepthGrid } from "./heuristic-depth.ts";
import { estimateHorizon } from "./lines.ts";
import { extractPalette, type PaletteColor } from "./palette.ts";
import { srgbToOklab } from "./oklab.ts";
import { segmentRegions } from "./regions.ts";
import { colorFromRgb, summaryText, type ImageAnalysis } from "./text-tables.ts";
import { measureValueStructure } from "./value-structure.ts";
import { visionConfig } from "./vision-config.ts";

const inputSchema = z.strictObject({
  images: z
    .array(
      z.strictObject({
        path: z.string().min(1).describe("Absolute path of a PNG or JPEG file."),
        label: z
          .string()
          .min(1)
          .optional()
          .describe("Name for the image; defaults to the file name."),
      }),
    )
    .min(1)
    .max(4),
  grid: z
    .strictObject({ columns: z.int().min(2).max(26), rows: z.int().min(2).max(26) })
    .optional()
    .describe("Cell grid for the tables and overlay; defaults to 8 by 8."),
  paletteSize: z.int().min(2).max(12).optional().describe("Palette colors; defaults to 6."),
});

const outputSchema = z.strictObject({
  analysisId: z.string(),
  folder: z.string(),
  images: z.array(
    z.strictObject({
      label: z.string(),
      width: z.int(),
      height: z.int(),
      tables: z.string(),
      marksPath: z.string(),
      palettePath: z.string(),
      analysisPath: z.string(),
      summaryPath: z.string(),
    }),
  ),
});

const visionFolder = ".roblox-kit/vision";
const swatchPixels = 64;
const measureLongEdge = 728;

function projectFolder(projectDir: string | undefined): string {
  return projectDir !== undefined && isAbsolute(projectDir) && !projectDir.includes("${")
    ? projectDir
    : process.cwd();
}

function blockAverage(
  image: RgbaImage,
  origin: { x: number; y: number },
  factor: number,
): number[] {
  const sums = [0, 0, 0, 0];
  for (let i = 0; i < factor * factor * 4; i++) {
    const offset = ((origin.y + Math.floor(i / (factor * 4))) * image.width + origin.x) * 4;
    const index = offset + (i % (factor * 4));
    sums[i % 4] = (sums[i % 4] ?? 0) + (image.data[index] ?? 0);
  }
  return sums.map((sum) => Math.round(sum / (factor * factor)));
}

function shrink(image: RgbaImage): { image: RgbaImage; factor: number } {
  const factor = Math.ceil(Math.max(image.width, image.height) / measureLongEdge);
  if (factor <= 1) return { image, factor: 1 };
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const origin = { x: (i % width) * factor, y: Math.floor(i / width) * factor };
    data.set(blockAverage(image, origin, factor), i * 4);
  }
  return { image: { width, height, data }, factor };
}

function lightnessPlane(image: RgbaImage): Float32Array {
  const plane = new Float32Array(image.width * image.height);
  for (let i = 0; i < plane.length; i++) {
    const [r = 0, g = 0, b = 0] = image.data.subarray(i * 4, i * 4 + 3);
    plane[i] = srgbToOklab(r / 255, g / 255, b / 255).l;
  }
  return plane;
}

function composite(image: RgbaImage, overlay: RgbaImage): RgbaImage {
  const data = new Uint8Array(image.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = (overlay.data[i + 3] ?? 0) / 255;
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.round(
        (overlay.data[i + c] ?? 0) * alpha + (image.data[i + c] ?? 0) * (1 - alpha),
      );
    }
    data[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

function swatches(palette: PaletteColor[]): RgbaImage {
  const width = swatchPixels * Math.max(1, palette.length);
  const data = new Uint8Array(width * swatchPixels * 4);
  for (let i = 0; i < data.length; i += 4) {
    const index = Math.floor(((i / 4) % width) / swatchPixels);
    const color = palette[index];
    data.set(color ? [...colorFromRgb(color), 255] : [0, 0, 0, 255], i);
  }
  return { width, height: swatchPixels, data };
}

function analyze(
  image: RgbaImage,
  label: string,
  input: z.output<typeof inputSchema>,
): ImageAnalysis {
  const grid = input.grid ?? {
    columns: visionConfig.depthGridColumns,
    rows: visionConfig.depthGridRows,
  };
  const small = shrink(image);
  const smallSize = { width: small.image.width, height: small.image.height };
  const measured = estimateHorizon(lightnessPlane(small.image), smallSize);
  return {
    label,
    width: image.width,
    height: image.height,
    grid,
    palette: extractPalette(image, input.paletteSize ?? visionConfig.paletteColors),
    value: measureValueStructure(small.image, grid),
    regions: segmentRegions(image, grid),
    horizon: { ...measured, horizonRow: measured.horizonRow * small.factor },
    depth: heuristicDepthGrid(smallSize, measured.horizonRow),
  };
}

async function writeImageFiles(
  folder: string,
  image: RgbaImage,
  analysis: ImageAnalysis,
): Promise<{
  tables: string;
  paths: Record<"marks" | "palette" | "analysis" | "summary", string>;
}> {
  await mkdir(folder, { recursive: true });
  const tables = summaryText(analysis);
  const paths = {
    marks: join(folder, "marks.png"),
    palette: join(folder, "palette.png"),
    analysis: join(folder, "analysis.json"),
    summary: join(folder, "summary.md"),
  };
  const marks = composite(image, drawGridMarks(image, analysis.grid, analysis.regions));
  await Promise.all([
    writeFile(paths.marks, encodePng(marks)),
    writeFile(paths.palette, encodePng(swatches(analysis.palette))),
    writeFile(paths.analysis, JSON.stringify(analysis)),
    writeFile(paths.summary, tables),
  ]);
  return { tables, paths };
}

export function createAnalyzeImageTool(
  projectDir: string | undefined,
): ToolDefinition<typeof inputSchema, typeof outputSchema> {
  return {
    name: "analyze_image",
    title: "Analyze image",
    description:
      "Measures one to four PNG or JPEG files in plain TypeScript, no Studio needed: palette (Oklab and Color3.fromRGB ints), value structure, edge grid, numbered regions, horizon row and a heuristic depth grid. Returns { analysisId, folder, images: [{ label, width, height, tables, marksPath, palettePath, analysisPath, summaryPath }] }, and writes marks.png (grid and region numbers over the image), palette.png, analysis.json and summary.md per image under .roblox-kit/vision/<analysisId>/image-<n>/. Depth is text only.",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, openWorldHint: false },
    async handler(input) {
      const analysisId = randomBytes(4).toString("hex");
      const root = join(projectFolder(projectDir), visionFolder, analysisId);
      const images = await Promise.all(
        input.images.map(async (entry, index) => {
          const decoded = decodeImage(await readFile(entry.path));
          const label = entry.label ?? basename(entry.path);
          const analysis = analyze(decoded, label, input);
          const folder = join(root, `image-${String(index + 1)}`);
          const { tables, paths } = await writeImageFiles(folder, decoded, analysis);
          return {
            label,
            width: decoded.width,
            height: decoded.height,
            tables,
            marksPath: paths.marks,
            palettePath: paths.palette,
            analysisPath: paths.analysis,
            summaryPath: paths.summary,
          };
        }),
      );
      return toolResult({ analysisId, folder: root, images });
    },
  };
}
