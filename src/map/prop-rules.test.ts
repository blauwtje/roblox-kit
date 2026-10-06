import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { loadPresets } from "../style/load-preset.ts";
import { isPropKind, propSize } from "./prop-placement.ts";
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

await test("a prop wider or deeper than its ratio of the avatar is a scale issue naming the axis", () => {
  const wideRule = benchRule.widthRatio;
  const deepRule = benchRule.depthRatio;
  assert.ok(wideRule !== undefined && deepRule !== undefined);
  const wide = bench({
    path: "wide",
    size: { x: wideRule.max * min + 1, y: bench().size.y, z: 2 },
  });
  const shallow = bench({
    path: "shallow",
    size: { x: 6, y: bench().size.y, z: deepRule.min * max - 0.1 },
  });
  const issues = findPropIssues([wide, shallow], preset);
  assert.deepEqual(
    issues.map((issue) => [issue.kind, issue.parts]),
    [
      ["scale", ["wide"]],
      ["scale", ["shallow"]],
    ],
  );
  assert.match(issues[0]?.detail ?? "", /wide/);
  assert.match(issues[1]?.detail ?? "", /deep/);
});

await test("every kit kind of every preset has height, width and depth ratios that fit its generated size", async () => {
  const wallHeights = [config.defaultWallHeightStuds, 16, 24];
  for (const [name, genre] of await loadPresets()) {
    const kinds = new Set(genre.propKit);
    for (const roomType of Object.values(genre.roomTypes ?? {})) {
      for (const kind of roomType.setPieces) kinds.add(kind);
    }
    for (const kind of kinds) {
      assert.ok(isPropKind(kind), `${name}: ${kind} is a prop kind`);
      for (const wallHeight of wallHeights.filter(
        (height) => height >= genre.sizeRules.minWallHeight,
      )) {
        const size = propSize(kind, wallHeight);
        const path = `${name}.${kind}.${String(wallHeight)}`;
        const record = bench({ kind, size, path });
        assert.deepEqual(
          findPropIssues([record], genre).filter((issue) => issue.kind === "scale"),
          [],
          `${name}: ${kind} at wall height ${String(wallHeight)}`,
        );
      }
    }
  }
});
