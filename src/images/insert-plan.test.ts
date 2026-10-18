import assert from "node:assert/strict";
import { test } from "node:test";
import { planInsert, type InsertEntry } from "./insert-plan.ts";

const base = { name: "A", image: "rbxassetid://1", parent: "Workspace.P", width: 128, height: 64 };

function one(entry: Partial<InsertEntry> & { kind: InsertEntry["kind"] }) {
  return planInsert([{ ...base, ...entry }]).entries[0];
}

await test("screen entries get the image ratio and safe insets", () => {
  const plan = planInsert([{ ...base, kind: "label" }]);
  assert.equal(plan.screenGui.screenInsets, "CoreUISafeInsets");
  assert.equal(plan.entries[0]?.aspectRatio, 2);
});

await test("sliced entries carry the centre and 0.5 scale", () => {
  const slice = { x0: 20, y0: 20, x1: 108, y1: 44 };
  assert.deepEqual(one({ kind: "button", slice })?.slice, { center: slice, sliceScale: 0.5 });
});

await test("buttons get a 48 px minimum, labels none", () => {
  assert.equal(one({ kind: "button" })?.minPixels, 48);
  assert.equal(one({ kind: "label" })?.minPixels, undefined);
});

await test("surface entries default to the front face and reject unknown ones", () => {
  assert.equal(one({ kind: "surface" })?.face, "Front");
  assert.throws(() => one({ kind: "surface", face: "Side" as "Front" }), /unknown face/);
});

await test("particle entries need a layout and cap the framerate at 30", () => {
  assert.deepEqual(
    [
      one({ kind: "particle", layout: "Grid4x4", framerate: 30 })?.layout,
      one({ kind: "particle", layout: "Grid4x4" })?.framerate,
    ],
    ["Grid4x4", 12],
  );
  assert.throws(() => one({ kind: "particle", layout: "Grid4x4", framerate: 31 }), /at most 30/);
  assert.throws(() => one({ kind: "particle" }), /layout/);
});

await test("rejects a bad image id, a bad size and a bad scale", () => {
  assert.throws(() => one({ kind: "label", image: "http://x" }), /rbxassetid/);
  assert.throws(() => one({ kind: "label", width: 2048 }), /whole pixels/);
  assert.throws(() => one({ kind: "label", scale: { x: 0, y: 1 } }), /scale/);
});
