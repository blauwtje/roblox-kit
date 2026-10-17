import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "../src/config.ts";
import { visionConfig } from "../src/vision/vision-config.ts";

const scriptConfig = Object.freeze({
  depthCacheFolder: ".roblox-kit/cache/depth",
  onnxRuntimePackage: "onnxruntime-node@1.30.0",
  depthModelUrl:
    "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_q4f16.onnx",
  depthModelSha256: "eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e",
  depthModelFile: "model_q4f16.onnx",
  depthModelInputSize: 518,
  depthModelMean: [0.485, 0.456, 0.406],
  depthModelStd: [0.229, 0.224, 0.225],
});

const runFile = promisify(execFile);
const cacheFolder = new URL(`../${scriptConfig.depthCacheFolder}/`, import.meta.url);
const modelPath = fileURLToPath(new URL(scriptConfig.depthModelFile, cacheFolder));

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sampleChannel(image: RgbaImage, point: { x: number; y: number }, channel: number): number {
  const { x, y } = point;
  const { width, height, data } = image;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const at = (px: number, py: number) => data[(py * width + px) * 4 + channel] ?? 0;
  const top = at(x0, y0) * (1 - (x - x0)) + at(x1, y0) * (x - x0);
  const bottom = at(x0, y1) * (1 - (x - x0)) + at(x1, y1) * (x - x0);
  return top * (1 - (y - y0)) + bottom * (y - y0);
}

/** Resizes (bilinear) to the model square and returns normalized planar RGB (CHW). */
export function preprocess(
  image: RgbaImage,
  size: number = scriptConfig.depthModelInputSize,
): Float32Array {
  const out = new Float32Array(3 * size * size);
  const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, value));
  for (let i = 0; i < size * size; i++) {
    const x = clamp((((i % size) + 0.5) * image.width) / size - 0.5, image.width);
    const y = clamp(((Math.floor(i / size) + 0.5) * image.height) / size - 0.5, image.height);
    for (let c = 0; c < 3; c++) {
      const mean = scriptConfig.depthModelMean[c] ?? 0;
      const std = scriptConfig.depthModelStd[c] ?? 1;
      out[c * size * size + i] = (sampleChannel(image, { x, y }, c) / 255 - mean) / std;
    }
  }
  return out;
}

/**
 * Turns an inverse-depth map (larger = nearer) into the ordinal grid of the heuristic arm: each cell is the mean of
 * its pixels, min-max scaled over the image, then flipped so 0 is nearest and the last level is farthest.
 */
export function inverseDepthToGrid(
  values: ArrayLike<number>,
  width: number,
  height: number,
): number[][] {
  const { depthGridColumns: columns, depthGridRows: rows, depthLevels: levels } = visionConfig;
  const sums = new Float64Array(rows * columns);
  const counts = new Float64Array(rows * columns);
  for (let i = 0; i < width * height; i++) {
    const row = Math.min(rows - 1, Math.floor((Math.floor(i / width) * rows) / height));
    const column = Math.min(columns - 1, Math.floor(((i % width) * columns) / width));
    sums[row * columns + column] = (sums[row * columns + column] ?? 0) + (values[i] ?? 0);
    counts[row * columns + column] = (counts[row * columns + column] ?? 0) + 1;
  }
  const means = Array.from(sums, (sum, i) => sum / Math.max(1, counts[i] ?? 1));
  const low = Math.min(...means);
  const span = Math.max(...means) - low;
  const level = (mean: number) =>
    Math.round((1 - (span === 0 ? 0.5 : (mean - low) / span)) * (levels - 1));
  return Array.from({ length: rows }, (_, row) =>
    means.slice(row * columns, (row + 1) * columns).map(level),
  );
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Installs onnxruntime-node and the SHA-256-checked weights into the git-ignored depth cache folder. */
export async function installDepthModel(): Promise<void> {
  const folder = fileURLToPath(cacheFolder);
  await mkdir(folder, { recursive: true });
  const packageFile = fileURLToPath(new URL("package.json", cacheFolder));
  if (!(await exists(packageFile))) await writeFile(packageFile, '{"private":true}\n');
  await runFile("npm", [
    "install",
    "--prefix",
    folder,
    "--no-save",
    scriptConfig.onnxRuntimePackage,
  ]);
  if (await exists(modelPath)) {
    if (sha256Hex(await readFile(modelPath)) === scriptConfig.depthModelSha256) return;
    await rm(modelPath);
  }
  const response = await fetch(scriptConfig.depthModelUrl, {
    signal: AbortSignal.timeout(config.upstreamTimeoutMs * 10),
  });
  if (!response.ok)
    throw new Error(`Downloading the depth model failed: HTTP ${String(response.status)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256Hex(bytes);
  if (actual !== scriptConfig.depthModelSha256)
    throw new Error(`Depth model SHA-256 is ${actual}, expected ${scriptConfig.depthModelSha256}.`);
  await writeFile(`${modelPath}.partial`, bytes);
  await rename(`${modelPath}.partial`, modelPath);
}

interface OrtTensor {
  data: ArrayLike<number>;
  dims: readonly number[];
}
interface OrtModule {
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: {
    create(path: string): Promise<{
      inputNames: string[];
      run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
    }>;
  };
}

export type DepthModel = (image: RgbaImage) => Promise<{ cells: number[][]; ms: number }>;

/** Loads the cached runtime by dynamic import; null when `install` has not run. */
export async function loadDepthModel(): Promise<DepthModel | null> {
  if (!(await exists(modelPath))) return null;
  let ort: OrtModule;
  try {
    ort = createRequire(new URL("package.json", cacheFolder))("onnxruntime-node") as OrtModule;
  } catch {
    return null;
  }
  const session = await ort.InferenceSession.create(modelPath);
  const size = scriptConfig.depthModelInputSize;
  return async (image) => {
    const started = performance.now();
    const input = new ort.Tensor("float32", preprocess(image), [1, 3, size, size]);
    const outputs = await session.run({ [session.inputNames[0] ?? "pixel_values"]: input });
    const depth = Object.values(outputs)[0];
    if (depth === undefined) throw new Error("The depth model returned no output.");
    const [height = size, width = size] = depth.dims.slice(-2);
    const cells = inverseDepthToGrid(depth.data, width, height);
    return { cells, ms: performance.now() - started };
  };
}
