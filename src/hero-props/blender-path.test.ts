import assert from "node:assert/strict";
import { test } from "node:test";
import { blenderPath } from "./blender-path.ts";

const macPath = "/Applications/Blender.app/Contents/MacOS/Blender";

await test("blenderPath prefers BLENDER_PATH over everything", () => {
  const env = { BLENDER_PATH: "/custom/blender", PATH: "/usr/bin" };
  assert.equal(
    blenderPath(env, () => true),
    "/custom/blender",
  );
});

await test("blenderPath finds blender on PATH before the install path", () => {
  const env = { PATH: "/a:/b" };
  assert.equal(
    blenderPath(env, () => true),
    "/a/blender",
  );
  assert.equal(
    blenderPath(env, (file) => file === "/b/blender" || file === macPath),
    "/b/blender",
  );
});

await test("blenderPath falls back to the macOS install path", () => {
  assert.equal(
    blenderPath({ PATH: "/a" }, (file) => file === macPath),
    macPath,
  );
});

await test("blenderPath ignores an empty BLENDER_PATH and throws when nothing exists", () => {
  assert.throws(() => blenderPath({ BLENDER_PATH: "", PATH: "/a" }, () => false), /BLENDER_PATH/);
});
