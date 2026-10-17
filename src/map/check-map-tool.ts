import { z } from "zod";
import { config } from "../config.ts";
import { trimRecipePrefix } from "../hero-props/prop-recipes.ts";
import { runLuauBatch, runLuauFile } from "../luau/run-luau-file.ts";
import type { ResourceDefinition, ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio, type StudioConnection } from "../studio/studio-connection.ts";
import { resolveName } from "../shared/resolve-name.ts";
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
import { mapZonesBatchPart, mapZonesSchema } from "./read-map-zones.ts";
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
  mapId: z.string().min(1).describe("The mapId that build_map returned."),
  objectives: z
    .array(z.strictObject({ name: z.string().min(1), x: z.number(), y: z.number(), z: z.number() }))
    .optional()
    .describe("Points in studs every spawn must reach; they replace the spec's objectives."),
  preset: z.string().min(1).optional().describe("The style preset the map was built with."),
  spec: relationMapSpecSchema.optional().describe("The spec the map was built with; needs preset."),
  studioId: z.string().min(1).optional().describe("Which Studio; optional while one is connected."),
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

/** Draw calls and triangles per zone camera: the cameras are framed here, the counts read in Studio. */
async function sampleSceneStats(
  connection: StudioConnection,
  studioId: string,
  zones: z.infer<typeof mapZonesSchema>["zones"],
): Promise<SceneStatSample[]> {
  const shots = zones.map((zone) =>
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
  return presets.get(resolveName(presetName, presets.keys(), "preset"));
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

/** The resource that serves each report stored by `check_map` at `config.checkReportUriPrefix` plus its id. */
export function checkReportResource(reports: CheckReportStore): ResourceDefinition {
  return {
    name: "check-report",
    uriTemplate: `${config.checkReportUriPrefix}{reportId}`,
    title: "Check report",
    description: "The full report of one check_map call, by reportId.",
    read(uri, variables) {
      const report = reports.get(String(variables["reportId"]));
      if (report === undefined) {
        throw new Error(
          `No check report at ${uri}. Reports last only while the roblox-kit server runs; call check_map again for a new one.`,
        );
      }
      return JSON.stringify(report);
    },
  };
}

/** Builds the tool around the store that keeps its full reports and serves them as resources. */
export function createCheckMapTool(
  reports: CheckReportStore,
): ToolDefinition<typeof checkMapInput, typeof checkMapOutput> {
  return {
    name: "check_map",
    title: "Check map",
    description:
      `Checks a map built by build_map for overlapping parts, floating parts and zones or objective points that a walk from any SpawnLocation cannot reach (a pair over ${String(config.maxPathStuds)} studs apart is an unreachable issue starting with tooFar). ` +
      `Takes the mapId that build_map returned, a Model under Workspace.${config.mapsFolderName}; a missing Model is an error. ` +
      `Optional inputs: objectives [{ name, x, y, z }] add targets; preset (a build_map style preset name) sets the agent size and adds scale, rotation, untextured and unbevelled issues; spec (the build_map spec) with a preset adds sizeRule, placement and unlit issues; studioId picks the Studio. An input the user did not ask for stays at its default. ` +
      `Read-only. Returns { reportId, reportUri, passed, partCount, zoneCount, reachabilityChecked, counts, sceneStats, budget, withinBudget, warnings, issues, issuesOmitted }: counts are exact; sceneStats is one { zone, drawCalls, triangles } sample per zone, compared to budget (the spec's performanceBudget, else ${String(config.maxDrawCalls)} draw calls and ${String(config.maxTriangles)} triangles), and an over-budget zone sets withinBudget false with a warning but does not fail passed; issues list the first ${String(config.maxInlineIssues)} with part paths and positions, and ${config.checkReportUriPrefix}{reportId} holds the full report (up to ${String(config.maxIssuesPerKind)} per kind) while this server runs.`,
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
      const [checked, records, mapZones] = await runLuauBatch({
        connection: context.studio,
        studioId,
        datamodelType: "Edit",
        entries: [
          {
            fileName: "check-map.luau",
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
              doorways: input.spec === undefined ? [] : doorwayClearanceBoxes(input.spec, agent),
            },
            resultSchema: checkedMapSchema,
          },
          {
            fileName: "read-props.luau",
            arguments: { mapId: input.mapId, mapsFolderName: config.mapsFolderName },
            resultSchema: mapRecordsSchema,
          },
          mapZonesBatchPart(input.mapId),
        ],
      });
      const propIssues = preset === undefined ? [] : findPropIssues(records.props, preset);
      const untexturedIssues =
        preset === undefined || preset.flatSurfaces === true
          ? []
          : findSurfaceIssues(records.surfaces);
      const unlitIssues =
        preset === undefined || input.spec === undefined
          ? []
          : findLightIssues(resolveRelations(input.spec).rooms, records.lights);
      const unbevelledIssues = preset === undefined ? [] : findBevelIssues(records.heroParts);
      const scaleIssues = propIssues.filter((issue) => issue.kind === "scale");
      const rotationIssues = propIssues.filter((issue) => issue.kind === "rotation");
      const sceneStats = await sampleSceneStats(context.studio, studioId, mapZones.zones);
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
