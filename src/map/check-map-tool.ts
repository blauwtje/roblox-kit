import { z } from "zod";
import { config } from "../config.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio } from "../studio/studio-connection.ts";
import {
  checkIssueSchema,
  checkReportUri,
  type CheckIssue,
  type CheckReportStore,
} from "./check-report-store.ts";

const issueCountsSchema = z.strictObject({
  overlapping: z.number().int(),
  floating: z.number().int(),
  unreachable: z.number().int(),
});

const checkMapInput = z.strictObject({
  /** The mapId that `build_map` returned. */
  mapId: z.string().min(1),
  /** Which Studio holds the map; optional while exactly one is connected. */
  studioId: z.string().min(1).optional(),
});

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
  issues: z.array(checkIssueSchema),
  /** Issues in the full report that are not listed inline. */
  issuesOmitted: z.number().int(),
});

/** What `check-map.luau` reports: exact counts and issue lists it has capped per kind. */
const checkedMapSchema = z.strictObject({
  partCount: z.number().int(),
  zoneCount: z.number().int(),
  reachabilityChecked: z.boolean(),
  counts: issueCountsSchema,
  issues: z.strictObject({
    overlapping: z.array(checkIssueSchema),
    floating: z.array(checkIssueSchema),
    unreachable: z.array(checkIssueSchema),
  }),
});

/** Builds the tool around the store that keeps its full reports and serves them as resources. */
export function createCheckMapTool(
  reports: CheckReportStore,
): ToolDefinition<typeof checkMapInput, typeof checkMapOutput> {
  return {
    name: "check_map",
    title: "Check map",
    description:
      `Checks a map built by build_map for overlapping parts, floating parts (not connected to the ground or terrain) and zones a walk from the first SpawnLocation cannot reach (Studio pathfinding). ` +
      `Takes the mapId that build_map returned, the name of a Model under Workspace.${config.mapsFolderName}; the handle lasts while that Model exists in the open place, and a missing Model is an error. ` +
      `Read-only. Returns { reportId, reportUri, passed, partCount, zoneCount, reachabilityChecked, counts, issues, issuesOmitted }: counts are exact, issues list the first ${String(config.maxInlineIssues)} with part paths and stud positions, ` +
      `and a resource link to ${config.checkReportUriPrefix}{reportId} holds the full report (up to ${String(config.maxIssuesPerKind)} issues per kind) for as long as this server runs. Rotated parts are checked by their world bounding box.`,
    inputSchema: checkMapInput,
    outputSchema: checkMapOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(input, context) {
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
          agentRadiusStuds: config.pathfindingAgentRadiusStuds,
          agentHeightStuds: config.pathfindingAgentHeightStuds,
        },
        resultSchema: checkedMapSchema,
      });
      const issues: CheckIssue[] = [
        ...checked.issues.overlapping,
        ...checked.issues.floating,
        ...checked.issues.unreachable,
      ];
      const report = reports.add(input.mapId, issues);
      const uri = checkReportUri(report.reportId);
      const totalIssues =
        checked.counts.overlapping + checked.counts.floating + checked.counts.unreachable;
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
          counts: checked.counts,
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
