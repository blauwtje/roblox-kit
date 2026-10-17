import assert from "node:assert/strict";
import { test } from "node:test";
import { blenderPath, runBlender } from "./blender-path.ts";

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

await test("runBlender names the script and the last 20 stderr lines when Blender fails", async () => {
  const stderr = Array.from({ length: 30 }, (_, index) => `line ${String(index + 1)}`).join("\n");
  const exec = () => Promise.reject(Object.assign(new Error("exit 1"), { stderr }));
  const previous = process.env.BLENDER_PATH;
  process.env.BLENDER_PATH = "/custom/blender";
  try {
    await assert.rejects(runBlender("/scripts/make.py", ["out"], exec), (error: Error) => {
      assert.match(error.message, /\/scripts\/make\.py/);
      assert.match(error.message, /line 30/);
      assert.match(error.message, /line 11/);
      assert.doesNotMatch(error.message, /line 10\b/);
      return true;
    });
  } finally {
    if (previous === undefined) delete process.env.BLENDER_PATH;
    else process.env.BLENDER_PATH = previous;
  }
});
