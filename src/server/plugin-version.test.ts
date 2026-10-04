import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { config } from "../config.ts";

const pluginManifestUrl = new URL("../../.claude-plugin/plugin.json", import.meta.url);
const pluginManifestSchema = z.object({ version: z.string() });

await test("plugin.json version equals config.serverVersion", () => {
  const manifest = pluginManifestSchema.parse(JSON.parse(readFileSync(pluginManifestUrl, "utf8")));
  assert.equal(manifest.version, config.serverVersion);
});
