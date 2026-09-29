import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../src/config.ts";
import { codeScoreOf } from "../src/eval/code-score.ts";
import { buildMapTool } from "../src/map/build-map-tool.ts";
import { captureZonesTool } from "../src/map/capture-zones-tool.ts";
import { CheckReportStore } from "../src/map/check-report-store.ts";
import { createCheckMapTool } from "../src/map/check-map-tool.ts";
import { relationMapSpecSchema } from "../src/map/map-spec.ts";
import type { ToolDefinition } from "../src/server/tool-definition.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";
import type { StudioConnection } from "../src/studio/studio-connection.ts";

/**
 * Builds, checks and captures each benchmark in `eval/benchmarks/` in the open Studio and appends one
 * JSON line per benchmark to `eval/results.jsonl`; images go to `eval/captures/<benchmark>/`.
 * The built maps stay in the place (named `benchmark-*`, replaced on the next run) so they can be looked at.
 */
const benchmarksUrl = new URL("../eval/benchmarks/", import.meta.url);
const capturesUrl = new URL("../eval/captures/", import.meta.url);
const resultsUrl = new URL("../eval/results.jsonl", import.meta.url);

const imageExtensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };

/** Calls a tool the way the server registry does: input parsed by its schema, output by its own. */
async function callTool<Input extends z.ZodObject, Output extends z.ZodObject>(
  tool: ToolDefinition<Input, Output>,
  rawInput: z.input<Input>,
  connection: StudioConnection,
) {
  const result = await tool.handler(tool.inputSchema.parse(rawInput), { studio: connection });
  if (result.isError === true) {
    const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    throw new Error(`${tool.name} returned an error: ${text}`);
  }
  return { output: tool.outputSchema.parse(result.structuredContent), content: result.content };
}

/** Writes each captured image to `eval/captures/<benchmark>/<zone>.<ext>` and returns the paths. */
async function saveCaptures(
  benchmark: string,
  zones: string[],
  content: { type: string; data?: string; mimeType?: string }[],
): Promise<string[]> {
  const directory = new URL(`${benchmark}/`, capturesUrl);
  await mkdir(directory, { recursive: true });
  const images = content.filter((block) => block.type === "image");
  if (images.length !== zones.length) {
    throw new Error(
      `${benchmark}: ${String(images.length)} images for ${String(zones.length)} zones.`,
    );
  }
  const paths: string[] = [];
  for (const [index, image] of images.entries()) {
    const zone = String(zones[index]);
    const extension = imageExtensions[image.mimeType ?? ""];
    if (extension === undefined || image.data === undefined) {
      throw new Error(`${benchmark}: image of zone "${zone}" has type ${String(image.mimeType)}.`);
    }
    await writeFile(new URL(`${zone}.${extension}`, directory), Buffer.from(image.data, "base64"));
    paths.push(`eval/captures/${benchmark}/${zone}.${extension}`);
  }
  return paths;
}

/** Builds, checks and captures one benchmark spec; returns its result line. */
async function evaluate(file: string, connection: StudioConnection) {
  const benchmark = file.replace(/\.json$/, "");
  const source: unknown = JSON.parse(await readFile(new URL(file, benchmarksUrl), "utf8"));
  const spec = relationMapSpecSchema.parse(source);
  const built = await callTool(buildMapTool, spec, connection);
  const checked = await callTool(
    createCheckMapTool(new CheckReportStore()),
    {
      mapId: spec.mapId,
      objectives: spec.objectives,
      preset: spec.style?.preset,
      spec,
    },
    connection,
  );
  const captured = await callTool(captureZonesTool, { mapId: spec.mapId }, connection);
  if (captured.output.remainingZones.length > 0) {
    throw new Error(
      `${benchmark}: zones left uncaptured: ${captured.output.remainingZones.join(", ")}.`,
    );
  }
  const captures = await saveCaptures(
    benchmark,
    captured.output.shots.map((shot) => shot.zone),
    captured.content,
  );
  const budget = spec.performanceBudget;
  return {
    benchmark,
    mapId: spec.mapId,
    ranAt: new Date().toISOString(),
    codeScore: codeScoreOf({
      counts: checked.output.counts,
      sceneStats: checked.output.sceneStats,
      budget,
    }),
    passed: checked.output.passed,
    counts: checked.output.counts,
    sceneStats: checked.output.sceneStats,
    budget,
    partCount: built.output.partCount,
    zoneCount: checked.output.zoneCount,
    captures,
    captureWarnings: captured.output.warnings,
  };
}

const connection = new StudioMcpClient({
  clientInfo: { name: `${config.serverName}-eval`, version: config.serverVersion },
  timeoutMs: config.upstreamTimeoutMs,
});
try {
  const files = (await readdir(benchmarksUrl)).filter((name) => name.endsWith(".json")).sort();
  for (const file of files) {
    const line = await evaluate(file, connection);
    await appendFile(resultsUrl, `${JSON.stringify(line)}\n`);
    console.log(
      `${line.benchmark}: codeScore ${String(line.codeScore)}, passed ${String(line.passed)}, ${String(line.captures.length)} images`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
}
