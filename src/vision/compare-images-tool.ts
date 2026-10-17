import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { createAnalyzeImageTool } from "./analyze-image-tool.ts";
import { compareAnalyses, findingsTable } from "./compare.ts";
import { decodeImage } from "./decode-image.ts";
import { encodePng, type RgbaImage } from "./encode-png.ts";
import type { ImageAnalysis } from "./text-tables.ts";

const visionFolder = ".roblox-kit/vision";
const sideBySideHeight = 360;
const analysisIdPattern = /^[0-9a-f]{8}$/;

const imageRef = z
  .string()
  .min(1)
  .describe("Absolute path of a PNG or JPEG file, or an analysisId that analyze_image returned.");

const inputSchema = z.strictObject({
  reference: imageRef.describe(`The target image. ${imageRef.description ?? ""}`),
  capture: imageRef.describe(`The image to judge. ${imageRef.description ?? ""}`),
  truth: z
    .strictObject({
      path: z.string().min(1).describe("Absolute path of a truth.json from measure_capture."),
      shot: z.int().min(0).optional().describe("Index into its shots; defaults to 0."),
    })
    .optional()
    .describe("Measured distances for the capture; depthDelta then compares against them."),
  grid: z
    .strictObject({ columns: z.int().min(2).max(26), rows: z.int().min(2).max(26) })
    .optional()
    .describe("Cell grid for path inputs; defaults to 8 by 8. An analysisId keeps its own grid."),
});

const outputSchema = z.strictObject({
  compareId: z.string(),
  folder: z.string(),
  sideBySidePath: z.string(),
  deltas: z.array(z.strictObject({ metric: z.string(), delta: z.number() })),
  suggestedCamera: z.strictObject({
    pitchChangeDegrees: z.number(),
    horizonRowReference: z.number(),
    horizonRowCapture: z.number(),
    advice: z.string(),
  }),
  table: z.string(),
});

type Input = z.output<typeof inputSchema>;

interface Resolved {
  analysis: ImageAnalysis;
  imagePath: string;
}

function projectFolder(projectDir: string | undefined): string {
  return projectDir !== undefined && isAbsolute(projectDir) && !projectDir.includes("${")
    ? projectDir
    : process.cwd();
}

async function resolveImage(
  value: string,
  where: { input: Input; projectDir: string | undefined },
  context: ToolContext,
): Promise<Resolved> {
  const { input, projectDir } = where;
  if (analysisIdPattern.test(value)) {
    const folder = join(projectFolder(projectDir), visionFolder, value, "image-1");
    const analysis = JSON.parse(
      await readFile(join(folder, "analysis.json"), "utf8"),
    ) as ImageAnalysis;
    return { analysis, imagePath: join(folder, "marks.png") };
  }
  const analyze = createAnalyzeImageTool(projectDir);
  const result = await analyze.handler(
    analyze.inputSchema.parse({ images: [{ path: value }], grid: input.grid }),
    context,
  );
  const [first] = analyze.outputSchema.parse(result.structuredContent).images;
  if (first === undefined) throw new Error(`analyze_image returned nothing for ${value}.`);
  const analysis = JSON.parse(await readFile(first.analysisPath, "utf8")) as ImageAnalysis;
  return { analysis, imagePath: value };
}

const truthFileSchema = z.object({
  shots: z.array(
    z.object({
      rows: z.array(z.array(z.nullable(z.object({ distanceStuds: z.number() })))),
    }),
  ),
});

async function readTruth(truth: NonNullable<Input["truth"]>): Promise<number[][]> {
  const file = truthFileSchema.parse(JSON.parse(await readFile(truth.path, "utf8")));
  const shot = file.shots[truth.shot ?? 0];
  if (shot === undefined) {
    throw new Error(
      `${truth.path} has ${String(file.shots.length)} shots, none at ${String(truth.shot ?? 0)}.`,
    );
  }
  return shot.rows.map((row) => row.map((cell) => (cell === null ? Infinity : cell.distanceStuds)));
}

function scaleToHeight(image: RgbaImage, height: number): RgbaImage {
  const width = Math.max(1, Math.round((image.width * height) / image.height));
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const x = Math.min(image.width - 1, Math.floor(((i % width) * image.width) / width));
    const y = Math.min(
      image.height - 1,
      Math.floor((Math.floor(i / width) * image.height) / height),
    );
    data.set(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4), i * 4);
  }
  return { width, height, data };
}

function sideBySide(left: RgbaImage, right: RgbaImage): RgbaImage {
  const width = left.width + right.width;
  const data = new Uint8Array(width * sideBySideHeight * 4);
  for (let y = 0; y < sideBySideHeight; y++) {
    data.set(left.data.subarray(y * left.width * 4, (y + 1) * left.width * 4), y * width * 4);
    data.set(
      right.data.subarray(y * right.width * 4, (y + 1) * right.width * 4),
      (y * width + left.width) * 4,
    );
  }
  return { width, height: sideBySideHeight, data };
}

async function loadScaled(path: string): Promise<RgbaImage> {
  return scaleToHeight(decodeImage(await readFile(path)), sideBySideHeight);
}

export function createCompareImagesTool(
  projectDir: string | undefined,
): ToolDefinition<typeof inputSchema, typeof outputSchema> {
  return {
    name: "compare_images",
    title: "Compare images",
    description:
      "Compares a capture with a reference image in plain TypeScript, no Studio needed. Each of reference and capture is a PNG or JPEG path or an analysisId from analyze_image; optional truth is a truth.json from measure_capture (with a shot index) and grid sets the cell grid for paths. Returns { compareId, folder, sideBySidePath, deltas, suggestedCamera, table }: deltas ranks paletteDelta, valueDelta, depthDelta (Spearman rank correlation of the capture's depth against the truth, or against the reference's heuristic depth without truth) and layoutDelta from 0 (same) to 1 (far apart), largest first; suggestedCamera gives the pitch change that moves the capture's horizon to the reference's; table lists the 8 largest differences. Writes side-by-side.png under .roblox-kit/vision/<compareId>/.",
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: false, openWorldHint: false },
    async handler(input, context) {
      const [reference, capture] = await Promise.all([
        resolveImage(input.reference, { input, projectDir }, context),
        resolveImage(input.capture, { input, projectDir }, context),
      ]);
      const truth = input.truth === undefined ? undefined : await readTruth(input.truth);
      const comparison = compareAnalyses(reference.analysis, capture.analysis, truth);
      const compareId = randomBytes(4).toString("hex");
      const folder = join(projectFolder(projectDir), visionFolder, compareId);
      await mkdir(folder, { recursive: true });
      const sideBySidePath = join(folder, "side-by-side.png");
      const [left, right] = await Promise.all([
        loadScaled(reference.imagePath),
        loadScaled(capture.imagePath),
      ]);
      await writeFile(sideBySidePath, encodePng(sideBySide(left, right)));
      return toolResult({
        compareId,
        folder,
        sideBySidePath,
        deltas: comparison.deltas,
        suggestedCamera: comparison.suggestedCamera,
        table: findingsTable(comparison.findings),
      });
    },
  };
}
