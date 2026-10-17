import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const luauSourceAllowlist: Readonly<Record<string, string>> = {
  "src/map/prop-generators.test.ts": "lints every prop generator's source for hardcoded looks",
  "src/map/prop-placement.test.ts": "checks that each prop kind has a generator file",
  "src/map/check-map-tool.test.ts": "pins check-map.luau rules that only run inside Studio",
  "src/lighting/apply-lighting.test.ts":
    "pins apply-lighting.luau rules that only run inside Studio",
};

const root = new URL("../../", import.meta.url);

function testFiles(directory: string): string[] {
  return readdirSync(new URL(directory, root), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `${directory}${name}`);
}

await test("no test reads luau source as text unless it is allowlisted with a reason", () => {
  const readsLuau = /\.\.\/luau\//;
  const offenders = [...testFiles("src/"), ...testFiles("hooks/")].filter(
    (file) =>
      file !== "src/shared/test-hygiene.test.ts" &&
      readsLuau.test(readFileSync(new URL(file, root), "utf8")),
  );
  const unlisted = offenders.filter((file) => !(file in luauSourceAllowlist));
  assert.deepEqual(
    unlisted,
    [],
    "test reads a luau/ path; test behavior instead, or allowlist it with a reason",
  );
  const stale = Object.keys(luauSourceAllowlist).filter((file) => !offenders.includes(file));
  assert.deepEqual(
    stale,
    [],
    "allowlisted file no longer reads luau/; remove it from the allowlist",
  );
});
