import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { tools } from "./main.ts";

const agentsUrl = new URL("../../agents/", import.meta.url);
const pluginManifestUrl = new URL("../../.claude-plugin/plugin.json", import.meta.url);
const pluginManifestSchema = z.object({
  name: z.string(),
  mcpServers: z.record(z.string(), z.unknown()),
});
const manifest = pluginManifestSchema.parse(JSON.parse(readFileSync(pluginManifestUrl, "utf8")));

/** The name a session running the plugin gives `capture_zones` (`claude --plugin-dir . --debug` or `/mcp`). */
const recordedCaptureZonesName = "mcp__plugin_roblox-kit_roblox-kit__capture_zones";

const expectedAgents = ["place-check", "quality-reviewer", "visual-judge"];

/** The `tools` list of an agent file's frontmatter. */
function agentTools(source: string): string[] {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "";
  const line = /^tools:\s*(.+)$/m.exec(frontmatter)?.[1] ?? "";
  return line.split(",").map((tool) => tool.trim());
}

await test("the plugin ships the three visual-judge agents", () => {
  const files = readdirSync(agentsUrl).filter((file) => file.endsWith(".md"));
  assert.deepEqual(files.sort(), expectedAgents.map((name) => `${name}.md`).sort());
});

for (const agent of expectedAgents) {
  await test(`agent ${agent} lists only Read and the recorded MCP tool names`, () => {
    const listed = agentTools(readFileSync(new URL(`${agent}.md`, agentsUrl), "utf8"));
    assert.ok(listed.length > 0, "the agent has a tools line");
    for (const tool of listed) {
      if (tool === "Read") {
        continue;
      }
      const match = /^mcp__plugin_(.+?)_(.+)__(.+)$/.exec(tool);
      assert.ok(match, `${tool} is Read or a plugin MCP tool name`);
      const [, plugin, server, toolName] = match;
      assert.equal(plugin, manifest.name, `${tool} names the plugin`);
      assert.ok(server && server in manifest.mcpServers, `${tool} names a server in plugin.json`);
      assert.ok(
        tools.some((definition) => definition.name === toolName),
        `${tool} names a tool in main.ts`,
      );
      assert.equal(tool, recordedCaptureZonesName);
    }
  });
}
