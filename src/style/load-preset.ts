import { readdir, readFile } from "node:fs/promises";
import { presetSchema, type Preset } from "./preset-schema.ts";

const bundledPresetsDirectory = new URL("../../presets/", import.meta.url);

const presetExtension = ".json";

/**
 * Every `*.json` file of `directory` parsed as a preset, keyed by its file name without the
 * extension. Throws naming the file when one is not valid JSON or fails the preset schema.
 */
export async function loadPresets(
  directory: URL = bundledPresetsDirectory,
): Promise<Map<string, Preset>> {
  const fileNames = (await readdir(directory)).filter((name) => name.endsWith(presetExtension));
  fileNames.sort();
  const presets = new Map<string, Preset>();
  for (const fileName of fileNames) {
    const presetName = fileName.slice(0, -presetExtension.length);
    const text = await readFile(new URL(fileName, directory), "utf8");
    presets.set(presetName, parsePreset(fileName, text));
  }
  return presets;
}

function parsePreset(fileName: string, text: string): Preset {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Preset ${fileName} is not valid JSON: ${String(error)}`, { cause: error });
  }
  const parsed = presetSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Preset ${fileName} is invalid: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
