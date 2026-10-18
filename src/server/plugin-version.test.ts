import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { pluginVersion } from "./main.ts";

const pluginManifestUrl = new URL("../../.claude-plugin/plugin.json", import.meta.url);
const devManifestUrl = new URL("../../.mcp.json", import.meta.url);
const pluginManifestSchema = z.object({ version: z.string() });
const serversSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.object({ env: z.record(z.string(), z.string()).optional() }).loose(),
  ),
});

await test("the server reports the plugin.json version", () => {
  const manifest = pluginManifestSchema.parse(JSON.parse(readFileSync(pluginManifestUrl, "utf8")));
  assert.equal(manifest.version, pluginVersion);
});

await test("plugin.json and .mcp.json carry no Open Cloud user settings", () => {
  const manifests = [pluginManifestUrl, devManifestUrl].map((url) => readFileSync(url, "utf8"));
  assert.ok(
    manifests.every((text) => !/userConfig|ROBLOX_OPEN_CLOUD/.test(text)),
    "a manifest names userConfig or a ROBLOX_OPEN_CLOUD variable",
  );
});

await test("plugin.json and .mcp.json declare the same mcpServers", () => {
  const [plugin, dev] = [pluginManifestUrl, devManifestUrl].map((url) => {
    const text = readFileSync(url, "utf8").replaceAll(
      "${CLAUDE_PLUGIN_ROOT:-.}",
      "${CLAUDE_PLUGIN_ROOT}",
    );
    return serversSchema.parse(JSON.parse(text));
  });
  assert.deepEqual(dev, plugin);
  assert.equal(plugin?.mcpServers["roblox-kit"]?.env?.["PROJECT_DIR"], "${CLAUDE_PROJECT_DIR}");
});
