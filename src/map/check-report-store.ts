import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../config.ts";

/** One finding of `check_map`: what is wrong, which part paths are involved and where in studs. */
export const checkIssueSchema = z.strictObject({
  kind: z.enum(["overlapping", "floating", "unreachable", "sizeRule"]),
  /** Full names of the parts involved, such as `Workspace.RobloxKitMaps.arena.start-floor`. */
  parts: z.array(z.string()),
  position: z.strictObject({ x: z.number(), y: z.number(), z: z.number() }),
  detail: z.string(),
});

export type CheckIssue = z.infer<typeof checkIssueSchema>;

export interface CheckReport {
  reportId: string;
  mapId: string;
  issues: CheckIssue[];
}

export function checkReportUri(reportId: string): string {
  return `${config.checkReportUriPrefix}${reportId}`;
}

/** Full check reports, kept in memory for the life of the server process. */
export class CheckReportStore {
  readonly #reports = new Map<string, CheckReport>();

  add(mapId: string, issues: CheckIssue[]): CheckReport {
    const report = { reportId: randomUUID(), mapId, issues };
    this.#reports.set(report.reportId, report);
    return report;
  }

  get(reportId: string): CheckReport | undefined {
    return this.#reports.get(reportId);
  }
}
