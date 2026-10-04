import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { CheckReportStore } from "./check-report-store.ts";

await test("the store keeps a report it just added", () => {
  const store = new CheckReportStore();
  const report = store.add("arena", []);
  assert.equal(store.get(report.reportId), report);
});

await test("the store drops its oldest report past the cap", () => {
  const store = new CheckReportStore();
  const first = store.add("map-0", []);
  const second = store.add("map-1", []);
  let newest = second;
  for (let index = 2; index <= config.maxCheckReports; index += 1) {
    newest = store.add(`map-${String(index)}`, []);
  }
  assert.equal(store.get(first.reportId), undefined);
  assert.equal(store.get(second.reportId), second);
  assert.equal(store.get(newest.reportId), newest);
});
