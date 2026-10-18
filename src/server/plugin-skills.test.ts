import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { tools } from "./main.ts";

const skillsUrl = new URL("../../skills/", import.meta.url);
const toolNames = new Set(tools.map((tool) => tool.name));

function skillName(source: string): string | undefined {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "";
  return /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
}

const skills = readdirSync(skillsUrl, { withFileTypes: true }).filter((entry) =>
  entry.isDirectory(),
);

for (const skill of skills) {
  await test(`skill ${skill.name} has its folder as name and names only real tools`, () => {
    const source = readFileSync(new URL(`${skill.name}/SKILL.md`, skillsUrl), "utf8");
    assert.equal(skillName(source), skill.name);
    const named = [...source.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)]
      .map((match) => match[1] ?? "")
      .filter(
        (word) =>
          toolNames.has(word) ||
          /^(build|check|capture|run|remove|judge|analyze|measure|compare)_/.test(word),
      );
    for (const name of named) {
      assert.ok(toolNames.has(name), `${name} is not a tool in main.ts`);
    }
  });
}

await test("the recreate-from-screenshot skill names its pipeline tools", () => {
  const source = readFileSync(new URL("recreate-from-screenshot/SKILL.md", skillsUrl), "utf8");
  for (const name of [
    "analyze_image",
    "build_map",
    "capture_zones",
    "compare_images",
    "judge_round",
  ]) {
    assert.ok(source.includes(`\`${name}\``), `${name} is named`);
    assert.ok(toolNames.has(name), `${name} is a tool`);
  }
});

const roughPhrases: Record<string, string[]> = {
  animation: ["make an animation", "walk cycle"],
  data: ["save player data", "gamepass"],
  luau: ["write a script", "fix my code"],
  "map-building": ["make a map", "build a level", "train station"],
  networking: ["remote event", "stop exploiters"],
  playtest: ["test my game", "playtest"],
  "visual-judge": ["does it look right", "rate this map"],
  "recreate-from-screenshot": ["copy this screenshot", "make it look like this picture"],
};

for (const skill of skills) {
  await test(`skill ${skill.name} description leads with what it provides and has user words`, () => {
    const source = readFileSync(new URL(`${skill.name}/SKILL.md`, skillsUrl), "utf8");
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "";
    const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? "";
    assert.ok(description.length > 0 && description.length <= 1024, "description is 1-1024 chars");
    assert.ok(!/^Use when/i.test(description), "description does not open with Use when");
    const phrases = roughPhrases[skill.name];
    assert.ok(phrases, `${skill.name} has rough phrases in the table`);
    for (const phrase of phrases) {
      assert.ok(description.toLowerCase().includes(phrase), `missing "${phrase}"`);
    }
  });
}
