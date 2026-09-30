import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPresets } from "../style/load-preset.ts";
import { findPropIssues, type PropRecord } from "./prop-rules.ts";

const preset = (await loadPresets()).get("train-station");
assert.ok(preset !== undefined);
const benchRule = preset.propRules["bench"];
assert.ok(benchRule?.heightRatio !== undefined);
const { min, max } = preset.sizeRules.avatarHeight;
const lowestHeight = benchRule.heightRatio.min * max;
const highestHeight = benchRule.heightRatio.max * min;

function bench(overrides: Partial<PropRecord> = {}): PropRecord {
  return {
    path: "Workspace.RobloxKitMaps.arena.bench-1",
    kind: "bench",
    size: { x: 6, y: (lowestHeight + highestHeight) / 2, z: 2 },
    position: { x: 1, y: 2, z: 3 },
    yaw: 0,
    upright: true,
    ...overrides,
  };
}

await test("a prop inside its height ratio on the 90-degree grid has no issue", () => {
  assert.deepEqual(
    findPropIssues([bench(), bench({ yaw: -270 }), bench({ yaw: 180.2 })], preset),
    [],
  );
});

await test("a prop over or under its height bounds is a scale issue naming its path and position", () => {
  const tall = bench({ size: { x: 6, y: highestHeight + 1, z: 2 } });
  const short = bench({ path: "short", size: { x: 6, y: lowestHeight - 0.1, z: 2 } });
  const issues = findPropIssues([tall, short], preset);
  assert.deepEqual(
    issues.map((issue) => [issue.kind, issue.parts]),
    [
      ["scale", [tall.path]],
      ["scale", ["short"]],
    ],
  );
  assert.deepEqual(issues[0]?.position, tall.position);
});

await test("an off-grid yaw or a tilted prop is a rotation issue", () => {
  const issues = findPropIssues([bench({ yaw: 45 }), bench({ upright: false })], preset);
  assert.deepEqual(
    issues.map((issue) => issue.kind),
    ["rotation", "rotation"],
  );
});

await test("a prop kind without a rule is not checked and free rotation allows any yaw", () => {
  assert.deepEqual(findPropIssues([bench({ kind: "unlisted", yaw: 45 })], preset), []);
  const free = { ...preset, propRules: { bench: { ...benchRule, freeRotation: true } } };
  assert.deepEqual(findPropIssues([bench({ yaw: 45 })], free), []);
});
