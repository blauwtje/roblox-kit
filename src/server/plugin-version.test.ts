import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { config } from "../config.ts";

const pluginManifestUrl = new URL("../../.claude-plugin/plugin.json", import.meta.url);
const devManifestUrl = new URL("../../.mcp.json", import.meta.url);
const pluginManifestSchema = z.object({ version: z.string() });
const serverEnvSchema = z.object({
  mcpServers: z.object({ "roblox-kit": z.object({ env: z.object({ PROJECT_DIR: z.string() }) }) }),
});

await test("plugin.json version equals config.serverVersion", () => {
  const manifest = pluginManifestSchema.parse(JSON.parse(readFileSync(pluginManifestUrl, "utf8")));
  assert.equal(manifest.version, config.serverVersion);
});

await test("plugin.json and .mcp.json carry no Open Cloud user settings", () => {
  const manifests = [pluginManifestUrl, devManifestUrl].map((url) => readFileSync(url, "utf8"));
  assert.ok(
    manifests.every((text) => !/userConfig|ROBLOX_OPEN_CLOUD/.test(text)),
    "a manifest names userConfig or a ROBLOX_OPEN_CLOUD variable",
  );
});

await test("plugin.json and .mcp.json pass the project folder to the roblox-kit server as PROJECT_DIR", () => {
  for (const url of [pluginManifestUrl, devManifestUrl]) {
    const manifest = serverEnvSchema.parse(JSON.parse(readFileSync(url, "utf8")));
    assert.equal(manifest.mcpServers["roblox-kit"].env.PROJECT_DIR, "${CLAUDE_PROJECT_DIR}");
  }
});
