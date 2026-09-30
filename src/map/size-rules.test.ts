import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../config.ts";
import { relationMapSpecSchema } from "./map-spec.ts";
import { doorwayClearanceBoxes, findDoorways, findSizeRuleIssues } from "./size-rules.ts";

const rules = { minDoorwayWidth: 10, minHallwayWidth: 12, minWallHeight: 12 };

function issuesOf(rooms: object[], extra: object = {}) {
  const spec = relationMapSpecSchema.parse({ mapId: "m", rooms, ...extra });
  return findSizeRuleIssues(spec, rules, "m");
}

const hub = { name: "hub", x: 0, z: 0, width: 40, depth: 40 };

await test("a map with wide doors and tall walls has no size-rule issues", () => {
  const rooms = [{ ...hub, doors: [{ side: "east", offset: 0 }] }];
  assert.deepEqual(issuesOf(rooms, { doorWidth: 12, wallHeight: 16 }), []);
});

await test("a default 6-stud door is reported with its side, width and world position", () => {
  const [issue, ...others] = issuesOf([{ ...hub, doors: [{ side: "east", offset: 5 }] }]);
  assert.deepEqual(others, []);
  assert.equal(issue?.kind, "sizeRule");
  assert.deepEqual(issue.position, { x: 19.5, y: 0, z: 5 });
  assert.match(issue.detail, /east wall of room "hub" is 6 studs wide.*at least 10/);
  assert.ok(
    issue.parts.every((path) =>
      path.startsWith(`Workspace.${config.mapsFolderName}.m.hub-wall-east-`),
    ),
  );
});

await test("walls under the minimum height are reported once per room", () => {
  const issues = issuesOf([hub], { wallHeight: 8 });
  assert.equal(issues.length, 1);
  assert.match(issues[0]?.detail ?? "", /Walls of room "hub" are 8 studs tall/);
});

await test("a narrow hallway is reported by width, and a wide one is not", () => {
  const related = (hallwayWidth: number) => [
    hub,
    {
      name: "vault",
      width: 20,
      depth: 20,
      relation: { to: "hub", direction: "east", hallwayLength: 20, hallwayWidth },
    },
  ];
  const narrow = issuesOf(related(8), { doorWidth: 10, wallHeight: 12 });
  const hallwayIssues = narrow.filter((issue) => /Hallway/.test(issue.detail));
  assert.equal(hallwayIssues.length, 1);
  assert.match(hallwayIssues[0]?.detail ?? "", /Hallway "hub-vault-hallway" is 8 studs wide/);
  assert.deepEqual(
    issuesOf(related(14), { doorWidth: 10, wallHeight: 12 }).filter((issue) =>
      /Hallway/.test(issue.detail),
    ),
    [],
  );
});

await test("a hallway shorter than it is wide is measured across its direction, not by its shorter side", () => {
  const related = (direction: string, hallwayWidth: number) => [
    hub,
    {
      name: "vault",
      width: 20,
      depth: 20,
      relation: { to: "hub", direction, hallwayLength: 10, hallwayWidth },
    },
  ];
  const hallwayIssuesOf = (direction: string, hallwayWidth: number) =>
    issuesOf(related(direction, hallwayWidth), { doorWidth: 10, wallHeight: 12 }).filter((issue) =>
      /Hallway/.test(issue.detail),
    );
  for (const direction of ["east", "north"]) {
    assert.deepEqual(hallwayIssuesOf(direction, 14), [], `${direction}: 14 wide, 10 long`);
    const narrow = hallwayIssuesOf(direction, 8);
    assert.equal(narrow.length, 1, `${direction}: 8 wide`);
    assert.match(narrow[0]?.detail ?? "", /Hallway "hub-vault-hallway" is 8 studs wide/);
  }
});

await test("findDoorways lists each opening with its room, side and width", () => {
  const spec = relationMapSpecSchema.parse({
    mapId: "m",
    rooms: [{ ...hub, doors: [{ side: "east", offset: 5 }] }],
  });
  const [doorway, ...others] = findDoorways(spec);
  assert.ok(doorway);
  assert.deepEqual(others, []);
  assert.equal(doorway.room, "hub");
  assert.equal(doorway.side, "east");
  assert.equal(doorway.width, 6);
  assert.deepEqual(doorway.position, { x: 19.5, y: 0, z: 5 });
});

await test("a doorway's clearance box spans its width, the wall and an agent radius on both faces, and the agent height", () => {
  const spec = relationMapSpecSchema.parse({
    mapId: "m",
    rooms: [{ ...hub, doors: [{ side: "east", offset: 5 }] }],
  });
  const [box] = doorwayClearanceBoxes(spec, { radius: 1.5, height: 5 });
  assert.ok(box);
  assert.equal(box.room, "hub");
  assert.deepEqual(box.min, { x: 19.5 - (0.5 + 3), y: 0, z: 5 - 3 });
  assert.deepEqual(box.max, { x: 19.5 + (0.5 + 3), y: 5, z: 5 + 3 });
});
