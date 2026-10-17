import { readFile } from "node:fs/promises";
import { buildMapTool } from "../src/map/build-map-tool.ts";
import { removeMapTool } from "../src/map/remove-map-tool.ts";
import type { StudioConnection } from "../src/studio/studio-connection.ts";
import { createMeasureCaptureTool } from "../src/vision/measure-capture-tool.ts";
import { recordedSmokeSpec, smokeMapSpec } from "./smoke/build.ts";
import { callRealTool, expectEqual } from "./smoke/shared.ts";

/**
 * Smoke step for measure_capture: rebuilds the smoke map (the earlier steps have removed it), shoots a 4 by 4
 * ray grid from views a, b and eye of every room, checks the shots and the truth.json file, and removes the map.
 */
export async function probeMeasureCapture(connection: StudioConnection): Promise<string> {
  await callRealTool(buildMapTool, recordedSmokeSpec, connection);
  try {
    const { output } = await callRealTool(
      createMeasureCaptureTool(process.env["PROJECT_DIR"]),
      { mapId: smokeMapSpec.mapId, views: ["a", "b", "eye"], grid: { columns: 4, rows: 4 } },
      connection,
    );
    expectEqual("measure_capture shots", output.shots.length, smokeMapSpec.rooms.length * 3);
    const blind = output.shots.filter((shot) => shot.hitCells === 0);
    expectEqual(
      "measure_capture shots that hit nothing",
      blind.map((shot) => `${shot.zone}:${shot.view}`),
      [],
    );
    const truth = JSON.parse(await readFile(output.truthPath, "utf8")) as { shots: unknown[] };
    expectEqual("truth.json shots", truth.shots.length, output.shots.length);
    const hits = output.shots.reduce((sum, shot) => sum + shot.hitCells, 0);
    return `${String(output.shots.length)} shots, ${String(hits)} cells hit, aspect ${String(output.aspect)}, ${output.truthPath}`;
  } finally {
    await callRealTool(removeMapTool, { mapId: smokeMapSpec.mapId }, connection);
  }
}
