import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { loadPresets } from "./load-preset.ts";

const surface = { material: "Concrete", color: "#808080" };
const light = { range: 40, brightness: 1, color: "#ffffff" };
const slot = { material: "Plastic", color: "#808080" };

function validPreset(exposure = 0.5) {
  return {
    palette: { colors: ["#111111", "#222222", "#333333"], accent: "#ff8800" },
    surfaces: { floor: surface, wall: surface, trim: surface, ceiling: surface, accent: surface },
    lighting: {
      LightingStyle: "Soft",
      PrioritizeLightingQuality: true,
      Ambient: "#202020",
      OutdoorAmbient: "#303030",
      Brightness: 2,
      ExposureCompensation: exposure,
      EnvironmentDiffuseScale: 0.5,
      EnvironmentSpecularScale: 0.5,
      ShadowSoftness: 0.2,
      Atmosphere: {
        Density: 0.3,
        Offset: 0.1,
        Color: "#aaaaaa",
        Decay: "#bbbbbb",
        Glare: 0,
        Haze: 1,
      },
      Bloom: { Intensity: 0.4, Size: 24, Threshold: 0.9 },
    },
    lightingIntent: "bright, even",
    lightRoles: { zoneMarker: light, focal: light, hero: light },
    propKit: ["bench", "lamp"],
    propSlots: {
      frame: slot,
      seat: slot,
      panel: slot,
      glass: slot,
      screen: slot,
      signage: slot,
      light: slot,
    },
    propRules: {
      bench: { heightRatio: { min: 0.34, max: 0.75 }, freeRotation: false, surface: "trim" },
      lamp: { heightRatio: { min: 1.03, max: 2.25 }, freeRotation: false, surface: "trim" },
    },
    sizeRules: {
      agentRadius: 2,
      agentHeight: 5,
      minDoorwayWidth: 10,
      minHallwayWidth: 10,
      minWallHeight: 10,
      avatarHeight: { min: 5, max: 6.5 },
    },
  };
}

async function withPresetFolder(
  files: Record<string, string>,
  body: (folder: URL) => Promise<void>,
): Promise<void> {
  const folderPath = await mkdtemp(join(tmpdir(), "presets-"));
  try {
    for (const [fileName, text] of Object.entries(files)) {
      await writeFile(join(folderPath, fileName), text);
    }
    await body(pathToFileURL(`${folderPath}/`));
  } finally {
    await rm(folderPath, { recursive: true, force: true });
  }
}

await test("loadPresets keys each preset by its file name", async () => {
  const files = {
    "alpha.json": JSON.stringify(validPreset(1)),
    "beta-town.json": JSON.stringify(validPreset(2)),
    "notes.txt": "not a preset",
  };
  await withPresetFolder(files, async (folder) => {
    const presets = await loadPresets(folder);
    assert.deepEqual([...presets.keys()], ["alpha", "beta-town"]);
    assert.equal(presets.get("alpha")?.lighting.ExposureCompensation, 1);
    assert.equal(presets.get("beta-town")?.lighting.ExposureCompensation, 2);
  });
});

await test("loadPresets names the file that fails the schema range", async () => {
  await withPresetFolder({ "bad.json": JSON.stringify(validPreset(9)) }, async (folder) => {
    await assert.rejects(loadPresets(folder), /Preset bad\.json is invalid/);
  });
});

await test("loadPresets names the file that is not valid JSON", async () => {
  await withPresetFolder({ "broken.json": "{" }, async (folder) => {
    await assert.rejects(loadPresets(folder), /Preset broken\.json is not valid JSON/);
  });
});
