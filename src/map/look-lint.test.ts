import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPresets } from "../style/load-preset.ts";
import { findLookIssues, type PlannedProp } from "./look-lint.ts";
import { mapSpecSchema } from "./map-spec.ts";

const preset = (await loadPresets()).get("train-station");
assert.ok(preset !== undefined);

function specOf(room: Record<string, unknown>) {
  return mapSpecSchema.parse({
    mapId: "lint",
    rooms: [{ name: "hall", x: 0, z: 0, width: 40, depth: 40, ...room }],
  });
}

const hall = specOf({});

function prop(overrides: Partial<PlannedProp> = {}): PlannedProp {
  return {
    kind: "bench",
    pivot: { x: 0, y: 1.5, z: 0 },
    size: { x: 6, y: 2.5, z: 2.5 },
    seed: 1,
    ...overrides,
  };
}

const kindsOf = (props: PlannedProp[], spec = hall): string[] =>
  findLookIssues(spec, props, preset).map((issue) => issue.kind);

await test("a well-scaled prop in the middle of a room has no scale, gap or facing issue", () => {
  assert.deepEqual(
    kindsOf([prop()]).filter((kind) => kind !== "density"),
    [],
  );
});

await test("a bench three times the avatar's height is a scale issue in its room", () => {
  const issues = findLookIssues(hall, [prop({ size: { x: 6, y: 16, z: 2.5 } })], preset);
  assert.equal(issues.find((issue) => issue.kind === "scale")?.zone, "hall");
});

await test("a prop 2 studs from a wall is a dead gap, 1 stud (the placer's clearance) and 0.1 are not", () => {
  const nearWall = (gap: number) =>
    prop({ pivot: { x: 0, y: 1.5, z: -(19 - 1.25 - gap) }, size: { x: 6, y: 2.5, z: 2.5 } });
  assert.ok(kindsOf([nearWall(2)]).includes("gap"));
  assert.ok(!kindsOf([nearWall(1)]).includes("gap"));
  assert.ok(!kindsOf([nearWall(0.1)]).includes("gap"));
});

await test("two props 2 studs apart are a dead gap", () => {
  const issues = findLookIssues(
    hall,
    [prop({ pivot: { x: -4, y: 1.5, z: 0 } }), prop({ pivot: { x: 4, y: 1.5, z: 0 } })],
    preset,
  );
  assert.equal(issues.filter((issue) => issue.kind === "gap").length, 1);
});

await test("a 6-stud walkway between opposite doorways suggests widening the room to 10 studs", () => {
  const narrow = specOf({ width: 8, doors: [{ side: "north" }, { side: "south" }] });
  const issue = findLookIssues(narrow, [], preset).find((found) => found.kind === "walkway");
  assert.equal(issue?.zone, "hall");
  const [patched] = issue.suggestedSpecPatch?.rooms ?? [];
  assert.equal(patched?.width, 12);
});

await test("a doorway under the preset minimum suggests the minimum door width", () => {
  const issue = findLookIssues(
    specOf({ doorWidth: 4, doors: [{ side: "east" }] }),
    [],
    preset,
  ).find((found) => found.kind === "doorway");
  const [patched] = issue?.suggestedSpecPatch?.rooms ?? [];
  assert.equal(patched?.doorWidth, preset.sizeRules.minDoorwayWidth);
});

await test("only walkway and doorway issues carry a suggested patch", () => {
  const issues = findLookIssues(
    specOf({ width: 8, doorWidth: 4, doors: [{ side: "north" }, { side: "south" }] }),
    [prop({ size: { x: 6, y: 16, z: 2.5 }, yaw: 0, pivot: { x: 0, y: 1.5, z: -10 } })],
    preset,
  );
  for (const issue of issues) {
    assert.equal(
      issue.suggestedSpecPatch !== undefined,
      issue.kind === "walkway" || issue.kind === "doorway",
      issue.kind,
    );
  }
});

await test("a prop whose front looks at the nearest wall faces away from its room, one facing in does not", () => {
  // Yaw 0 looks north (-Z): a prop on the north side faces the wall, one on the south side faces the room.
  const onNorth = prop({ kind: "counter", yaw: 0, pivot: { x: 0, y: 2, z: -15 } });
  const onSouth = prop({ kind: "counter", yaw: 0, pivot: { x: 0, y: 2, z: 15 } });
  assert.ok(kindsOf([onNorth]).includes("facing"));
  assert.ok(!kindsOf([onSouth]).includes("facing"));
});

await test("props covering over 40% of a room's floor, or none of a large one, are a density issue", () => {
  const slab = prop({ size: { x: 30, y: 2.5, z: 20 } });
  assert.ok(kindsOf([slab]).includes("density"));
  assert.ok(kindsOf([]).includes("density"));
  assert.ok(!kindsOf([prop({ size: { x: 12, y: 2.5, z: 10 } })]).includes("density"));
});
