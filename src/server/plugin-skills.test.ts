import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  "game-formula": ["front page game", "rebirth"],
  luau: ["write a script", "fix my code"],
  "map-building": ["make a map", "build a level", "train station"],
  networking: ["remote event", "stop exploiters"],
  playtest: ["test my game", "playtest"],
  "ui-images": ["button image", "9-slice"],
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

for (const skill of skills) {
  await test(`skill ${skill.name} stays within 8,000 bytes and its relative links resolve`, () => {
    const url = new URL(`${skill.name}/SKILL.md`, skillsUrl);
    const source = readFileSync(url, "utf8");
    assert.ok(Buffer.byteLength(source) <= 8000, "SKILL.md is over 8,000 bytes");
    const links = [
      ...source.matchAll(/`\$\{CLAUDE_SKILL_DIR\}\/([^`]+)`|\]\((?!https?:|#)([^)#]+)/g),
    ];
    for (const match of links) {
      const target = match[1] ?? match[2] ?? "";
      assert.ok(
        existsSync(new URL(target, new URL(`${skill.name}/`, skillsUrl))),
        `${target} exists`,
      );
    }
  });
}

const maxStepLength = 700;

for (const skill of skills) {
  await test(`skill ${skill.name} keeps each numbered step within ${String(maxStepLength)} characters`, () => {
    const source = readFileSync(new URL(`${skill.name}/SKILL.md`, skillsUrl), "utf8");
    for (const line of source.split("\n")) {
      if (!/^\d+\. /.test(line)) continue;
      assert.ok(
        line.length <= maxStepLength,
        `${String(line.length)} characters: ${line.slice(0, 60)}`,
      );
    }
  });
}

const maxRoughBytes = 600;

for (const skill of skills) {
  await test(`skill ${skill.name} has a Rough requests section within ${String(maxRoughBytes)} bytes`, () => {
    const source = readFileSync(new URL(`${skill.name}/SKILL.md`, skillsUrl), "utf8");
    const section = /^## Rough requests\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(source)?.[0];
    assert.ok(section, "missing ## Rough requests");
    assert.ok(Buffer.byteLength(section.trim()) <= maxRoughBytes, "section is over budget");
  });
}

const uiImageTerms = [
  "Use when",
  "Not for",
  "insert_images",
  "ImageColor3",
  "CoreUISafeInsets",
  "TextLabel",
  "FontFace",
  "1024",
  "2x",
  "48",
];

await test("the ui-images skill exists and states its drawing rules", () => {
  assert.ok(
    skills.some((skill) => skill.name === "ui-images"),
    "skills/ui-images is missing",
  );
  const source = readFileSync(new URL("ui-images/SKILL.md", skillsUrl), "utf8");
  for (const term of uiImageTerms) {
    assert.ok(source.includes(term), `ui-images names ${term}`);
  }
});
