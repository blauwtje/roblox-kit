import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

await test("a real script prints its usage for --help and exits 0 without running", () => {
  const result = spawnSync(process.execPath, ["scripts/check-blink-output.ts", "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: node scripts\/check-blink-output\.ts/);
  assert.doesNotMatch(result.stdout, /Blink output matches/);
});

await test("a real script exits 2 and names an unknown option", () => {
  const result = spawnSync(process.execPath, ["scripts/check-blink-output.ts", "--bogus"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--bogus/);
});
