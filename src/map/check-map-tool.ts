import { z } from "zod";
import { config } from "../config.ts";
import { trimRecipePrefix } from "../hero-props/prop-recipes.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio, type StudioConnection } from "../studio/studio-connection.ts";
import { loadPresets } from "../style/load-preset.ts";
import type { Preset } from "../style/preset-schema.ts";
import {
  checkIssueSchema,
  checkReportUri,
  type CheckIssue,
  type CheckReportStore,
} from "./check-report-store.ts";
import {
  defaultPerformanceBudget,
  relationMapSpecSchema,
  type PerformanceBudget,
} from "./map-spec.ts";
import {
  findBevelIssues,
  findLightIssues,
  findPropIssues,
  findSurfaceIssues,
  mapRecordsSchema,
} from "./prop-rules.ts";
import { resolveRelations } from "./relation-solver.ts";
import { doorwayClearanceBoxes, findSizeRuleIssues } from "./size-rules.ts";
import { zoneShot } from "./zone-cameras.ts";

const presets = await loadPresets();

/** The counts `check-map.luau` reports; `sizeRule` is computed here from the spec, `scale` and `rotation` from the props. */
const luauCountsSchema = z.strictObject({
  overlapping: z.number().int(),
  floating: z.number().int(),
  unreachable: z.number().int(),
  placement: z.number().int(),
});

const issueCountsSchema = luauCountsSchema.extend({
  sizeRule: z.number().int(),
  scale: z.number().int(),
  rotation: z.number().int(),
  untextured: z.number().int(),
  unlit: z.number().int(),
  unbevelled: z.number().int(),
});

const checkMapInput = z.strictObject({
  /** The mapId that `build_map` returned. */
  mapId: z.string().min(1),
  /** Points in studs that every spawn must be able to walk to; they replace the objectives of `spec`. */
  objectives: z
    .array(z.strictObject({ name: z.string().min(1), x: z.number(), y: z.number(), z: z.number() }))
    .optional(),
  /** The genre preset the map was built with; its size rules give the pathfinding agent's size. */
  preset: z.string().min(1).optional(),
  /** The spec the map was built with; with `preset` it is measured against the preset's size rules. */
  spec: relationMapSpecSchema.optional(),
  /** Which Studio holds the map; optional while exactly one is connected. */
  studioId: z.string().min(1).optional(),
});

const sceneStatSampleSchema = z.strictObject({
  zone: z.string(),
  drawCalls: z.number().int(),
  triangles: z.number().int(),
});

export type SceneStatSample = z.infer<typeof sceneStatSampleSchema>;

const checkMapOutput = z.strictObject({
  reportId: z.string(),
  reportUri: z.string(),
  mapId: z.string(),
  passed: z.boolean(),
  partCount: z.number().int(),
  zoneCount: z.number().int(),
  /** False when the map has no SpawnLocation, so no path could start. */
  reachabilityChecked: z.boolean(),
  /** Exact number of issues found per kind. */
  counts: issueCountsSchema,
  /** Scene draw calls and triangles seen from each zone's camera, in zone order. */
  sceneStats: z.array(sceneStatSampleSchema),
  /** The limits each sample is compared to: the spec's performanceBudget, else the config defaults. */
  budget: z.strictObject({ maxDrawCalls: z.number().int(), maxTriangles: z.number().int() }),
  /** False when any zone camera sees more draw calls or triangles than the budget allows. */
  withinBudget: z.boolean(),
  /** One line per zone camera over the budget and per instance outside the map that blocks a failed walk. */
  warnings: z.array(z.string()),
  issues: z.array(checkIssueSchema),
  /** Issues in the full report that are not listed inline. */
  issuesOmitted: z.number().int(),
});

/** What `check-map.luau` reports: exact counts and issue lists it has capped per kind. */
const checkedMapSchema = z.strictObject({
  partCount: z.number().int(),
  zoneCount: z.number().int(),
  reachabilityChecked: z.boolean(),
  counts: luauCountsSchema,
  issues: z.strictObject({
    overlapping: z.array(checkIssueSchema),
    floating: z.array(checkIssueSchema),
    unreachable: z.array(checkIssueSchema),
    placement: z.array(checkIssueSchema),
  }),
  warnings: z.array(z.string()),
});

const vectorSchema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });

/** What `read-map-zones.luau` reports: each zone with the studs bounds of its parts. */
const mapZonesSchema = z.strictObject({
  zones: z.array(z.strictObject({ name: z.string(), min: vectorSchema, max: vectorSchema })),
});

/** The props, flat parts, lights and hero MeshParts of the map with what the quality and prop rules need, read in Studio. */
async function readMapRecords(connection: StudioConnection, studioId: string, mapId: string) {
  const read = await runLuauFile({
    connection,
    studioId,
    fileName: "read-props.luau",
    datamodelType: "Edit",
    arguments: { mapId, mapsFolderName: config.mapsFolderName },
    resultSchema: mapRecordsSchema,
  });
  return read;
}

/** Draw calls and triangles per zone camera: the cameras are framed here, the counts read in Studio. */
async function sampleSceneStats(
  connection: StudioConnection,
  studioId: string,
  mapId: string,
): Promise<SceneStatSample[]> {
  const mapZones = await runLuauFile({
    connection,
    studioId,
    fileName: "read-map-zones.luau",
    datamodelType: "Edit",
    arguments: {
      mapId,
      mapsFolderName: config.mapsFolderName,
      floorNameSuffix: config.floorNameSuffix,
      spawnNameSuffix: config.spawnNameSuffix,
      wallNameInfix: config.wallNameInfix,
    },
    resultSchema: mapZonesSchema,
  });
  const shots = mapZones.zones.map((zone) =>
    zoneShot({ name: zone.name, bounds: { min: zone.min, max: zone.max } }),
  );
  const sampled = await runLuauFile({
    connection,
    studioId,
    fileName: "sample-scene-stats.luau",
    datamodelType: "Edit",
    arguments: { shots, statsSettleSeconds: config.statsSettleSeconds },
    resultSchema: z.strictObject({ samples: z.array(sceneStatSampleSchema) }),
    timeoutMs: (shots.length * config.statsSettleSeconds + config.statsCallMarginSeconds) * 1000,
  });
  return sampled.samples;
}

/** One warning per zone camera sample over either limit of the budget. */
function overBudgetWarnings(samples: SceneStatSample[], budget: PerformanceBudget): string[] {
  const warnings: string[] = [];
  for (const sample of samples) {
    if (sample.drawCalls > budget.maxDrawCalls) {
      warnings.push(
        `Zone "${sample.zone}" camera sees ${String(sample.drawCalls)} draw calls, over the budget of ${String(budget.maxDrawCalls)}.`,
      );
    }
    if (sample.triangles > budget.maxTriangles) {
      warnings.push(
        `Zone "${sample.zone}" camera sees ${String(sample.triangles)} triangles, over the budget of ${String(budget.maxTriangles)}.`,
      );
    }
  }
  return warnings;
}

/** The named preset; an unknown name is an error, no name is none. */
function presetNamed(presetName: string | undefined): Preset | undefined {
  if (presetName === undefined) {
    return undefined;
  }
  const preset = presets.get(presetName);
  if (preset === undefined) {
    const known = [...presets.keys()].join(", ");
    throw new Error(`Unknown preset "${presetName}". Use one of: ${known}.`);
  }
  return preset;
}

/** The preset's agent size, or the config defaults without a preset. */
function agentSizeFor(preset: Preset | undefined): { radius: number; height: number } {
  if (preset === undefined) {
    return {
      radius: config.pathfindingAgentRadiusStuds,
      height: config.pathfindingAgentHeightStuds,
    };
  }
  return { radius: preset.sizeRules.agentRadius, height: preset.sizeRules.agentHeight };
}

/** Builds the tool around the store that keeps its full reports and serves them as resources. */
export function createCheckMapTool(
  reports: CheckReportStore,
): ToolDefinition<typeof checkMapInput, typeof checkMapOutput> {
  return {
    name: "check_map",
    title: "Check map",
    description:
      `Checks a map built by build_map for overlapping parts, floating parts (not connected to the ground or terrain) and zones and objective points that a walk from any SpawnLocation cannot reach (Studio pathfinding; a pair of spawn and target over ${String(config.maxPathStuds)} studs apart is reported as an unreachable issue whose detail starts with tooFar). ` +
      `Optional objectives [{ name, x, y, z }] add targets and an optional preset (a build_map style preset name) sets the agent size from its size rules. ` +
      `With both preset and spec (the build_map spec) it also reports sizeRule issues for doorways, hallways and walls smaller than the preset's size rules, computed from the layout; without either, counts.sizeRule is 0. With a preset it also reads the map's props and reports scale issues (a prop's height outside the preset's heightRatio of the avatar height, naming the prop) and rotation issues (a prop whose yaw is not a multiple of 90 degrees or that is tilted, where the preset's rule does not allow free rotation). ` +
      `It also reports placement issues for each prop (at its declared size about its pivot) that has no floor part under its center and four footprint corners, overlaps a wall part, or stands inside a doorway's clearance box (the opening's width, the wall's thickness plus an agent radius on each face, and the agent's height; needs the spec, else only the floor and wall rules apply); the detail names the rule. ` +
      `Takes the mapId that build_map returned, the name of a Model under Workspace.${config.mapsFolderName}; the handle lasts while that Model exists in the open place, and a missing Model is an error. ` +
      `Read-only. Returns { reportId, reportUri, passed, partCount, zoneCount, reachabilityChecked, counts, sceneStats, budget, withinBudget, warnings, issues, issuesOmitted }: counts are exact, sceneStats is one { zone, drawCalls, triangles } sample per zone read from that zone's camera after ${String(config.statsSettleSeconds)} second of settling, compared to budget (the spec's performanceBudget, else ${String(config.maxDrawCalls)} draw calls and ${String(config.maxTriangles)} triangles): withinBudget is false and warnings name each zone over a limit, without failing passed; warnings also name any model outside the map that stands between a spawn and a target it cannot reach; issues list the first ${String(config.maxInlineIssues)} with part paths and stud positions, ` +
      `and a resource link to ${config.checkReportUriPrefix}{reportId} holds the full report (up to ${String(config.maxIssuesPerKind)} issues per kind) for as long as this server runs. Rotated parts are checked by their world bounding box. ` +
      `With a preset it also reports untextured issues (a part whose two longest sides both exceed ${String(config.maxUntexturedSurfaceStuds)} studs and that has no texture, material variant or textured material; none for a preset with flatSurfaces) and unbevelled issues (a hero prop MeshPart whose recipe shape has no bevel), and with the spec too unlit issues (a room with no light inside its footprint).`,
    inputSchema: checkMapInput,
    outputSchema: checkMapOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(input, context) {
      const preset = presetNamed(input.preset);
      const agent = agentSizeFor(preset);
      // Size rules need both the preset that holds them and the spec that gives the layout; without either none are reported.
      const sizeRuleIssues =
        preset === undefined || input.spec === undefined
          ? []
          : findSizeRuleIssues(input.spec, preset.sizeRules, input.mapId);
      const studioId = await selectStudio(context.studio, input.studioId);
      const checked = await runLuauFile({
        connection: context.studio,
        studioId,
        fileName: "check-map.luau",
        datamodelType: "Edit",
        arguments: {
          mapId: input.mapId,
          mapsFolderName: config.mapsFolderName,
          overlapToleranceStuds: config.overlapToleranceStuds,
          maxIssuesPerKind: config.maxIssuesPerKind,
          floorNameSuffix: config.floorNameSuffix,
          wallNameInfix: config.wallNameInfix,
          trimKindPrefix: trimRecipePrefix,
          agentRadiusStuds: agent.radius,
          agentHeightStuds: agent.height,
          maxPathStuds: config.maxPathStuds,
          objectives: input.objectives ?? input.spec?.objectives ?? [],
          // Doorway clearance needs the spec's layout; without a spec no doorway is known.
          doorways: input.spec === undefined ? [] : doorwayClearanceBoxes(input.spec, agent),
        },
        resultSchema: checkedMapSchema,
      });
      // Prop and quality rules apply to a styled map; without a preset nothing is read. The light rule also needs the spec's rooms.
      const records =
        preset === undefined
          ? undefined
          : await readMapRecords(context.studio, studioId, input.mapId);
      const propIssues =
        preset === undefined || records === undefined ? [] : findPropIssues(records.props, preset);
      const untexturedIssues =
        records === undefined || preset?.flatSurfaces === true
          ? []
          : findSurfaceIssues(records.surfaces);
      const unlitIssues =
        records === undefined || input.spec === undefined
          ? []
          : findLightIssues(resolveRelations(input.spec).rooms, records.lights);
      const unbevelledIssues = records === undefined ? [] : findBevelIssues(records.heroParts);
      const scaleIssues = propIssues.filter((issue) => issue.kind === "scale");
      const rotationIssues = propIssues.filter((issue) => issue.kind === "rotation");
      const sceneStats = await sampleSceneStats(context.studio, studioId, input.mapId);
      const budget = input.spec?.performanceBudget ?? defaultPerformanceBudget;
      const budgetWarnings = overBudgetWarnings(sceneStats, budget);
      const issues: CheckIssue[] = [
        ...checked.issues.overlapping,
        ...checked.issues.floating,
        ...checked.issues.unreachable,
        ...checked.issues.placement,
        ...sizeRuleIssues.slice(0, config.maxIssuesPerKind),
        ...scaleIssues.slice(0, config.maxIssuesPerKind),
        ...rotationIssues.slice(0, config.maxIssuesPerKind),
        ...untexturedIssues.slice(0, config.maxIssuesPerKind),
        ...unlitIssues.slice(0, config.maxIssuesPerKind),
        ...unbevelledIssues.slice(0, config.maxIssuesPerKind),
      ];
      const counts = {
        ...checked.counts,
        sizeRule: sizeRuleIssues.length,
        scale: scaleIssues.length,
        rotation: rotationIssues.length,
        untextured: untexturedIssues.length,
        unlit: unlitIssues.length,
        unbevelled: unbevelledIssues.length,
      };
      const report = reports.add(input.mapId, issues);
      const uri = checkReportUri(report.reportId);
      const totalIssues =
        counts.overlapping +
        counts.floating +
        counts.unreachable +
        counts.placement +
        counts.sizeRule +
        counts.scale +
        counts.rotation +
        counts.untextured +
        counts.unlit +
        counts.unbevelled;
      const inlineIssues = issues.slice(0, config.maxInlineIssues);
      return toolResult(
        {
          reportId: report.reportId,
          reportUri: uri,
          mapId: input.mapId,
          passed: totalIssues === 0,
          partCount: checked.partCount,
          zoneCount: checked.zoneCount,
          reachabilityChecked: checked.reachabilityChecked,
          counts,
          sceneStats,
          budget,
          withinBudget: budgetWarnings.length === 0,
          warnings: [...budgetWarnings, ...checked.warnings],
          issues: inlineIssues,
          issuesOmitted: totalIssues - inlineIssues.length,
        },
        [
          {
            type: "resource_link",
            uri,
            name: `check-report-${report.reportId}`,
            title: `Check report for ${input.mapId}`,
            mimeType: "application/json",
          },
        ],
      );
    },
  };
}
