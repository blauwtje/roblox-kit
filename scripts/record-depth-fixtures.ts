import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { buildMapTool } from "../src/map/build-map-tool.ts";
import { captureZonesTool } from "../src/map/capture-zones-tool.ts";
import { relationMapSpecSchema } from "../src/map/map-spec.ts";
import type { ToolDefinition } from "../src/server/tool-definition.ts";
import type { StudioConnection } from "../src/studio/studio-connection.ts";
import { decodeImage } from "../src/vision/decode-image.ts";
import {
  depthFixtureColumns,
  depthFixtureName,
  depthFixtureRows,
  writeDepthFixture,
  type DepthTruthCell,
} from "../src/vision/depth-fixture.ts";
import { createMeasureCaptureTool } from "../src/vision/measure-capture-tool.ts";
import { withStudio } from "./lib/run-script.ts";

const benchmarksUrl = new URL("../eval/benchmarks/", import.meta.url);
const depthRoot = fileURLToPath(new URL("../eval/depth/", import.meta.url));
const views = ["a", "b", "eye"] as const;

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

const truthSchema = z.object({
  shots: z.array(
    z.object({
      zone: z.string(),
      view: z.string(),
      rows: z.array(z.array(z.union([z.object({ distanceStuds: z.number() }), z.null()]))),
    }),
  ),
});

type TruthRows = (DepthTruthCell | null)[][];

async function writeShots(
  benchmark: string,
  captured: {
    shots: { zone: string; view: string }[];
    images: { type: string; data?: string }[];
    truthOf: Map<string, TruthRows>;
  },
): Promise<number> {
  const { shots, images, truthOf } = captured;
  for (const [index, shot] of shots.entries()) {
    const rows = truthOf.get(`${shot.zone}/${shot.view}`);
    const data = images[index]?.data;
    if (rows === undefined || data === undefined) {
      throw new Error(`${benchmark}: no truth for ${shot.zone} view ${shot.view}.`);
    }
    await writeDepthFixture({
      root: depthRoot,
      name: depthFixtureName(benchmark, shot.zone, shot.view),
      image: decodeImage(Buffer.from(data, "base64")),
      rows,
    });
  }
  return shots.length;
}

async function record(file: string, connection: StudioConnection): Promise<number> {
  const benchmark = file.replace(/\.json$/, "");
  const spec = relationMapSpecSchema.parse(
    JSON.parse(await readFile(new URL(file, benchmarksUrl), "utf8")),
  );
  await callTool(buildMapTool, spec, connection);
  const measured = await callTool(
    createMeasureCaptureTool(undefined),
    {
      mapId: spec.mapId,
      views: [...views],
      grid: { columns: depthFixtureColumns, rows: depthFixtureRows },
    },
    connection,
  );
  const truth = truthSchema.parse(JSON.parse(await readFile(measured.output.truthPath, "utf8")));
  const truthOf = new Map<string, (DepthTruthCell | null)[][]>(
    truth.shots.map((shot) => [`${shot.zone}/${shot.view}`, shot.rows]),
  );
  let written = 0;
  let zones: string[] | undefined;
  do {
    const captured = await callTool(
      captureZonesTool,
      { mapId: spec.mapId, zones, views: [...views], cutaway: false },
      connection,
    );
    const images = captured.content.filter((block) => block.type === "image");
    if (images.length !== captured.output.shots.length) {
      throw new Error(
        `${benchmark}: ${String(images.length)} images for ${String(captured.output.shots.length)} shots.`,
      );
    }
    written += await writeShots(benchmark, { shots: captured.output.shots, images, truthOf });
    if (zones !== undefined && captured.output.remainingZones.length >= zones.length) {
      throw new Error(
        `${benchmark}: zones left uncaptured: ${captured.output.remainingZones.join(", ")}.`,
      );
    }
    zones = captured.output.remainingZones.length > 0 ? captured.output.remainingZones : undefined;
  } while (zones !== undefined);
  return written;
}

try {
  await withStudio({ name: "record-depth-fixtures" }, async (connection) => {
    const files = (await readdir(benchmarksUrl)).filter((name) => name.endsWith(".json")).sort();
    for (const file of files) {
      console.log(`${file}: ${String(await record(file, connection))} fixtures`);
    }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
