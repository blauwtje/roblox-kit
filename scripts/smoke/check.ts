import { config } from "../../src/config.ts";
import { CheckReportStore } from "../../src/map/check-report-store.ts";
import { createCheckMapTool } from "../../src/map/check-map-tool.ts";
import { selectStudio, type StudioConnection } from "../../src/studio/studio-connection.ts";
import { callRealTool, executeLuau, expectEqual } from "./shared.ts";
import { blockerModelName, readMapDecor, smokeMapSpec, smokeRelationSpec } from "./build.ts";

export async function probeCheckMap(connection: StudioConnection): Promise<string> {
  const tool = createCheckMapTool(new CheckReportStore());
  const { output, content } = await callRealTool(
    tool,
    { mapId: smokeMapSpec.mapId, preset: smokeRelationSpec.style?.preset, spec: smokeRelationSpec },
    connection,
  );
  // check_map boxes every BasePart under the Model, including the parts the props generated.
  expectEqual("check_map partCount", output.partCount, (await readMapDecor(connection)).baseParts);
  expectEqual("check_map zoneCount", output.zoneCount, smokeMapSpec.rooms.length);
  expectEqual("check_map reachabilityChecked", output.reachabilityChecked, true);
  expectEqual(
    "check_map resource_link",
    content.some((block) => block.type === "resource_link"),
    true,
  );
  const counted =
    output.counts.overlapping +
    output.counts.floating +
    output.counts.unreachable +
    output.counts.placement +
    output.counts.sizeRule +
    output.counts.scale +
    output.counts.rotation +
    output.counts.untextured +
    output.counts.unlit +
    output.counts.unbevelled;
  expectEqual("check_map issues + omitted", output.issues.length + output.issuesOmitted, counted);
  expectEqual("check_map passed", output.passed, counted === 0);
  // A clean map: any issue here is a finding, not something to tolerate.
  expectEqual("check_map counts", output.counts, {
    overlapping: 0,
    floating: 0,
    unreachable: 0,
    placement: 0,
    sizeRule: 0,
    scale: 0,
    rotation: 0,
    untextured: 0,
    unlit: 0,
    unbevelled: 0,
  });
  expectEqual(
    "check_map sceneStats zones",
    output.sceneStats.map((sample) => sample.zone).sort(),
    smokeMapSpec.rooms.map((room) => room.name).sort(),
  );
  for (const sample of output.sceneStats) {
    // A zone camera looks at the room's floor and walls: both counts are above zero.
    expectEqual(`check_map sceneStats ${sample.zone} drawCalls > 0`, sample.drawCalls > 0, true);
    expectEqual(`check_map sceneStats ${sample.zone} triangles > 0`, sample.triangles > 0, true);
  }
  expectEqual("check_map budget", output.budget, smokeRelationSpec.performanceBudget);
  // The smoke map is small and nothing else stands in the smoke region: no zone is over budget, no walk blocked.
  expectEqual("check_map withinBudget", output.withinBudget, true);
  expectEqual("check_map warnings", output.warnings, []);
  return `passed=${String(output.passed)} counts=${JSON.stringify(output.counts)} sceneStats=${JSON.stringify(output.sceneStats)}`;
}

/** Walls off the hallway between the hall and the vault with a Model outside the smoke map. */
export function blockerLuau(): string {
  const roomNamed = (name: string) => {
    const room = smokeMapSpec.rooms.find((candidate) => candidate.name === name);
    if (room === undefined) throw new Error(`The smoke map has no room "${name}".`);
    return room;
  };
  const hall = roomNamed("hall");
  const vault = roomNamed("vault");
  const hallwayMiddleX = (hall.x + hall.width / 2 + vault.x - vault.width / 2) / 2;
  return `
local model = Instance.new("Model")
model.Name = "${blockerModelName}"
local wall = Instance.new("Part")
wall.Name = "Wall"
wall.Anchored = true
wall.Size = Vector3.new(2, 40, ${String(hall.depth + 10)})
wall.Position = Vector3.new(${String(hallwayMiddleX)}, 20, ${String(hall.z)})
wall.Parent = model
model.Parent = workspace:FindFirstChild("${config.mapsFolderName}")
return "placed"`;
}

/** Proves check_map names a Model outside the map that walls off a walk, then removes that Model. */
export async function probeBlockingModel(connection: StudioConnection): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  await executeLuau(connection, studioId, blockerLuau());
  try {
    const tool = createCheckMapTool(new CheckReportStore());
    const { output } = await callRealTool(tool, { mapId: smokeMapSpec.mapId }, connection);
    const blockerPath = `Workspace.${config.mapsFolderName}.${blockerModelName}`;
    expectEqual("check_map unreachable > 0 with the blocker", output.counts.unreachable > 0, true);
    expectEqual(
      "check_map warnings naming the blocker",
      output.warnings.filter((warning) => warning.startsWith(`${blockerPath} `)).length,
      1,
    );
    return output.warnings.join(" | ");
  } finally {
    await executeLuau(
      connection,
      studioId,
      `local folder = workspace:FindFirstChild("${config.mapsFolderName}")
local model = if folder then folder:FindFirstChild("${blockerModelName}") else nil
if model then model:Destroy() end
return "removed"`,
    );
  }
}
