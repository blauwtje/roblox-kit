import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const contributing = readFileSync(new URL("../../CONTRIBUTING.md", import.meta.url), "utf8");

function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `README has no ## ${heading}`);
  const next = text.indexOf("\n## ", start + 1);
  return text.slice(start, next === -1 ? undefined : next);
}

await test("README has a Troubleshooting section for Studio MCP, the empty list and Node", () => {
  const troubleshooting = section(readme, "Troubleshooting");
  assert.match(troubleshooting, /Studio MCP is off/);
  assert.match(troubleshooting, /list is empty/);
  assert.match(troubleshooting, /Node version/);
});

await test("README has no Development section and CONTRIBUTING holds the steps", () => {
  assert.doesNotMatch(readme, /^## Development$/m);
  for (const term of [
    "smoke:studio",
    "eval:studio",
    "hero-props",
    "Open Cloud",
    "Blink",
    "ProfileStore",
  ]) {
    assert.ok(contributing.includes(term), `CONTRIBUTING.md does not mention ${term}`);
  }
});

await test("README tool sections point to the schema instead of field tables", () => {
  const toolReference = section(readme, "Tool reference");
  assert.match(toolReference, /schema/);
  assert.doesNotMatch(toolReference, /^\| (Input|Field)/m);
  assert.doesNotMatch(toolReference, /^\|/m);
});
