import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { buildPhaseNames } from "../map/build-phases.ts";
import { tools } from "./main.ts";

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const contributing = readFileSync(new URL("../../CONTRIBUTING.md", import.meta.url), "utf8");
const claudeMd = readFileSync(new URL("../../.claude/CLAUDE.md", import.meta.url), "utf8");
const root = new URL("../../", import.meta.url);
const packageScripts = Object.keys(
  (JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as { scripts: object }).scripts,
);
const numberWords = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];
function word(count: number): string {
  return numberWords[count] ?? String(count);
}
const privatePrefixes = [".roblox-kit/", ".exo/", "docs/", "origin/", "tools/list"];

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

await test("README and CLAUDE.md name every tool, skill folder and agent file", () => {
  const skills = readdirSync(new URL("skills/", root), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const agents = readdirSync(new URL("agents/", root)).map((file) => file.replace(/\.md$/, ""));
  for (const [file, text] of [
    ["README.md", readme],
    [".claude/CLAUDE.md", claudeMd],
  ] as const) {
    for (const name of [...tools.map((tool) => tool.name), ...skills]) {
      assert.ok(text.includes(name), `${file} does not name ${name}`);
    }
  }
  for (const name of agents) {
    assert.ok(readme.includes(`\`${name}\``), `README does not name agent \`${name}\``);
  }
});

await test("the docs count the tools, skills and build phases as they are", () => {
  const skillCount = readdirSync(new URL("skills/", root), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  ).length;
  for (const text of [readme, claudeMd]) {
    assert.match(text, new RegExp(`\\b${word(tools.length)} tools\\b`));
    assert.match(text, new RegExp(`\\b${word(skillCount)} skills\\b`));
  }
  assert.match(claudeMd, new RegExp(`${word(buildPhaseNames.length)} ordered phases`));
  assert.match(readme, new RegExp(`${word(buildPhaseNames.length)} phases`));
  for (const name of buildPhaseNames) {
    assert.ok(readme.includes(name), `README does not name the ${name} phase`);
  }
});

await test("every npm run script the docs name is in package.json", () => {
  for (const [file, text] of [
    ["README.md", readme],
    ["CONTRIBUTING.md", contributing],
    [".claude/CLAUDE.md", claudeMd],
  ] as const) {
    for (const [, script] of text.matchAll(/npm run ([\w:-]+)/g)) {
      assert.ok(
        packageScripts.includes(script ?? ""),
        `${file} names missing script ${script ?? ""}`,
      );
    }
  }
});

await test("every repo path CLAUDE.md puts in backticks exists", () => {
  const paths = [...claudeMd.matchAll(/`([^`\s]+\/[^`\s]*)`/g)]
    .map((match) => match[1] ?? "")
    .filter((path) => !/[<>*{}:]/.test(path) && !path.startsWith("$"))
    .filter((path) => !privatePrefixes.some((prefix) => path.startsWith(prefix)));
  assert.ok(paths.length > 10);
  for (const path of paths) {
    assert.ok(existsSync(new URL(path, root)), `CLAUDE.md names missing path ${path}`);
  }
});

await test("CLAUDE.md describes the agents and hooks folders", () => {
  assert.match(claudeMd, /`agents\/`/);
  assert.match(claudeMd, /`hooks\/`/);
});
