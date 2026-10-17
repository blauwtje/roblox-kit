import { appendFile, readdir, readFile } from "node:fs/promises";
import { decodeImage } from "../src/vision/decode-image.ts";
import { evaluateDepth, type DepthEvalFrame, type DepthGrid } from "../src/vision/depth-eval.ts";
import { heuristicDepthGrid } from "../src/vision/heuristic-depth.ts";
import { estimateHorizon } from "../src/vision/lines.ts";
import { srgbToOklab } from "../src/vision/oklab.ts";
import { runScript } from "./lib/run-script.ts";

const depthUrl = new URL("../eval/depth/", import.meta.url);
const resultsUrl = new URL("../eval/results.jsonl", import.meta.url);

async function readGrid(url: URL): Promise<{ cells: number[][]; ms: number } | null> {
  try {
    const parsed = JSON.parse(await readFile(url, "utf8")) as { cells: number[][]; ms?: number };
    return { cells: parsed.cells, ms: parsed.ms ?? 0 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function loadFrame(name: string): Promise<DepthEvalFrame> {
  const dir = new URL(`${name}/`, depthUrl);
  const truth = await readGrid(new URL("truth.json", dir));
  if (truth === null) throw new Error(`eval/depth/${name}/truth.json is missing.`);
  const image = decodeImage(await readFile(new URL("image.jpg", dir)));
  const started = performance.now();
  const lightness = new Float32Array(image.width * image.height);
  for (let i = 0; i < lightness.length; i++) {
    const { data } = image;
    lightness[i] = srgbToOklab(data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0).l;
  }
  const horizon = estimateHorizon(lightness, image);
  const cells = heuristicDepthGrid(image, horizon.horizonRow).cells;
  const heuristic: DepthGrid = { cells, ms: performance.now() - started };
  const model = await readGrid(new URL("model.json", dir));
  return { truth: truth.cells, heuristic, ...(model ? { model } : {}) };
}

await runScript({
  name: "eval-depth",
  usage:
    "Usage: node scripts/eval-depth.ts\nScores eval/depth/*/ (image.jpg, truth.json, optional model.json {cells, ms}; larger = farther) and appends to eval/results.jsonl.",
  run: async () => {
    const entries = await readdir(depthUrl, { withFileTypes: true }).catch(() => []);
    const names = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const frames = await Promise.all(names.map(loadFrame));
    const result = evaluateDepth(frames);
    const line = { kind: "depth-eval", ranAt: new Date().toISOString(), ...result };
    await appendFile(resultsUrl, `${JSON.stringify(line)}\n`);
    console.log(JSON.stringify(line, null, 2));
    return 0;
  },
});
