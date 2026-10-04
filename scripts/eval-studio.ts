import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../src/config.ts";
import { blindPlaceCheck } from "../src/eval/blind-place-check.ts";
import type { PlaceCheckResult } from "../src/eval/blind-place-check.ts";
import { codeScoreOf } from "../src/eval/code-score.ts";
import { reviewRoomQuality, type QualityResult } from "../src/eval/quality-review.ts";
import { readReferenceSet, referenceImagePath } from "../src/eval/reference-set.ts";
import { buildMapTool } from "../src/map/build-map-tool.ts";
import { captureZonesTool } from "../src/map/capture-zones-tool.ts";
import { CheckReportStore } from "../src/map/check-report-store.ts";
import { createCheckMapTool } from "../src/map/check-map-tool.ts";
import { relationMapSpecSchema } from "../src/map/map-spec.ts";
import type { RelationMapSpec } from "../src/map/map-spec.ts";
import { loadPresets } from "../src/style/load-preset.ts";
import { resolveStyle } from "../src/style/resolve-style.ts";
import type { ToolDefinition } from "../src/server/tool-definition.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";
import type { StudioConnection } from "../src/studio/studio-connection.ts";
import { assertViewportVisible } from "../src/studio/viewport-preflight.ts";

/**
 * Builds, checks and captures each benchmark in `eval/benchmarks/` in the open Studio, runs the blind place
 * check on each typed room, and appends one JSON line per benchmark to `eval/results.jsonl`; images go to
 * `eval/captures/<benchmark>/`. The run fails when a place check fails, after every benchmark is recorded.
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

/** Writes each captured image to `eval/captures/<benchmark>/<zone>-<view>.<ext>` and returns the paths. */
async function saveCaptures(
  benchmark: string,
  shots: { zone: string; view: string }[],
  content: { type: string; data?: string; mimeType?: string }[],
): Promise<string[]> {
  const directory = new URL(`${benchmark}/`, capturesUrl);
  await mkdir(directory, { recursive: true });
  const images = content.filter((block) => block.type === "image");
  if (images.length !== shots.length) {
    throw new Error(
      `${benchmark}: ${String(images.length)} images for ${String(shots.length)} shots.`,
    );
  }
  const paths: string[] = [];
  for (const [index, image] of images.entries()) {
    const shot = shots[index];
    const name = `${String(shot?.zone)}-${String(shot?.view)}`;
    const extension = imageExtensions[image.mimeType ?? ""];
    if (extension === undefined || image.data === undefined) {
      throw new Error(`${benchmark}: image "${name}" has type ${String(image.mimeType)}.`);
    }
    await writeFile(new URL(`${name}.${extension}`, directory), Buffer.from(image.data, "base64"));
    paths.push(`eval/captures/${benchmark}/${name}.${extension}`);
  }
  return paths;
}

interface TypedRoom {
  name: string;
  roomType: string;
}

function typedRooms(spec: RelationMapSpec): TypedRoom[] {
  return spec.rooms.flatMap((room) =>
    room.roomType === undefined ? [] : [{ name: room.name, roomType: room.roomType }],
  );
}

function currentWaveRooms(spec: RelationMapSpec): TypedRoom[] {
  return typedRooms(spec).filter((room) => config.evalWaveRoomTypes.includes(room.roomType));
}

function captureOf(captures: string[], room: string, view: string): string | undefined {
  return captures.find((path) => path.split("/").at(-1)?.startsWith(`${room}-${view}.`));
}

async function captureUntilDone(
  benchmark: string,
  request: z.input<typeof captureZonesTool.inputSchema>,
  connection: StudioConnection,
): Promise<{ captures: string[]; warnings: string[] }> {
  const capturePaths = new Set<string>();
  const warnings: string[] = [];
  let zones = request.zones;
  do {
    const captured = await callTool(captureZonesTool, { ...request, zones }, connection);
    if (zones !== undefined && captured.output.remainingZones.length >= zones.length) {
      throw new Error(
        `${benchmark}: zones left uncaptured: ${captured.output.remainingZones.join(", ")}.`,
      );
    }
    // Every call repeats the whole-map cutaway under the same file name, so the set keeps one path.
    const paths = await saveCaptures(benchmark, captured.output.shots, captured.content);
    for (const path of paths) capturePaths.add(path);
    warnings.push(...captured.output.warnings);
    zones = captured.output.remainingZones;
  } while (zones.length > 0);
  return { captures: [...capturePaths], warnings };
}

async function qualityReviews(spec: RelationMapSpec, captures: string[]): Promise<QualityResult[]> {
  if (spec.style === undefined) {
    return [];
  }
  const genre = spec.style.preset;
  const referencePaths = (await readReferenceSet()).map(referenceImagePath);
  const reviews: QualityResult[] = [];
  for (const room of currentWaveRooms(spec)) {
    const capturePaths = ["eye", "a", "b"].flatMap(
      (view) => captureOf(captures, room.name, view) ?? [],
    );
    reviews.push(
      await reviewRoomQuality(room.name, genre, room.roomType, referencePaths, capturePaths),
    );
  }
  return reviews;
}

/**
 * The blind place check (skills/visual-judge SKILL.md step 5) of each typed room of a styled benchmark, from
 * the room zone's saved view a and view b images; a benchmark without a style has no typed rooms.
 */
async function placeChecks(spec: RelationMapSpec, captures: string[]): Promise<PlaceCheckResult[]> {
  if (spec.style === undefined) {
    return [];
  }
  const genre = spec.style.preset;
  const roomTypes = resolveStyle(await loadPresets(), spec.style).roomTypes ?? {};
  return Promise.all(
    typedRooms(spec).map(({ name, roomType }) => {
      const views = ["a", "b"].map((view) => captureOf(captures, name, view));
      const imagePaths = views.filter((path) => path !== undefined);
      if (imagePaths.length !== views.length) {
        const error = `Room "${name}" has no view a and view b capture to place-check.`;
        return Promise.resolve({ room: name, genre, roomType, error, passed: false });
      }
      const acceptedNames = roomTypes[roomType]?.roomNames ?? [];
      return blindPlaceCheck(name, genre, roomType, acceptedNames, imagePaths);
    }),
  );
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
  const cutaways = await captureUntilDone(benchmark, { mapId: spec.mapId }, connection);
  const waveRoomNames = currentWaveRooms(spec).map((room) => room.name);
  const eyeViews =
    waveRoomNames.length === 0
      ? { captures: [], warnings: [] }
      : await captureUntilDone(
          benchmark,
          { mapId: spec.mapId, zones: waveRoomNames, views: ["eye"], cutaway: false },
          connection,
        );
  const captures = [...cutaways.captures, ...eyeViews.captures];
  const captureWarnings = [...cutaways.warnings, ...eyeViews.warnings];
  const placeCheck = await placeChecks(spec, captures);
  const quality = await qualityReviews(spec, captures);
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
    checkPassed: checked.output.passed,
    counts: checked.output.counts,
    sceneStats: checked.output.sceneStats,
    budget,
    partCount: built.output.partCount,
    zoneCount: checked.output.zoneCount,
    captures,
    captureWarnings,
    checkIssues: checked.output.issues,
    checkIssuesOmitted: checked.output.issuesOmitted,
    placeCheck,
    placeCheckPassed: placeCheck.every((check) => check.passed),
    quality,
  };
}

const connection = new StudioMcpClient({
  clientInfo: { name: `${config.serverName}-eval`, version: config.serverVersion },
  timeoutMs: config.upstreamTimeoutMs,
});
try {
  await assertViewportVisible(connection);
  const files = (await readdir(benchmarksUrl)).filter((name) => name.endsWith(".json")).sort();
  const failedPlaceChecks: string[] = [];
  const failedQualityRooms: string[] = [];
  for (const file of files) {
    const line = await evaluate(file, connection);
    await appendFile(resultsUrl, `${JSON.stringify(line)}\n`);
    console.log(
      `${line.benchmark}: codeScore ${String(line.codeScore)}, checkPassed ${String(line.checkPassed)}, ${String(line.captures.length)} images, place check ${line.placeCheckPassed ? "passed" : "FAILED"}`,
    );
    for (const check of line.placeCheck) {
      const named =
        check.answer === undefined
          ? `nothing (${String(check.error)})`
          : `${check.answer.genre} / ${check.answer.room} (${check.answer.furnished})`;
      console.log(
        `  ${check.room} (${check.roomType}): named ${named}: ${check.passed ? "pass" : "fail"}`,
      );
      if (!check.passed) {
        failedPlaceChecks.push(
          `${line.benchmark} ${check.room}: named ${named}, not ${check.genre} / ${check.roomType} furnished`,
        );
      }
    }
    for (const review of line.quality) {
      const scores =
        review.medians === undefined
          ? `no scores (${String(review.error)})`
          : Object.entries(review.medians)
              .map(([axis, median]) => `${axis} ${String(median)}`)
              .join(", ");
      console.log(`  ${review.room} (${review.roomType}) quality: ${scores}`);
      if (!review.passed) {
        failedQualityRooms.push(`${line.benchmark} ${review.room} (${review.roomType}): ${scores}`);
      }
    }
  }
  const failures: string[] = [];
  if (failedPlaceChecks.length > 0) {
    failures.push(`The blind place check failed:\n${failedPlaceChecks.join("\n")}`);
  }
  if (failedQualityRooms.length > 0) {
    failures.push(`Rooms below the pass score:\n${failedQualityRooms.join("\n")}`);
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
}
