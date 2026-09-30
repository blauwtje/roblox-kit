import { presetOverridesSchema, presetSchema, type Preset } from "./preset-schema.ts";

/** What a map spec's `style` carries: a preset name and optional overrides of any subset of it. */
export interface StyleSelection {
  preset: string;
  overrides?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge: nested objects merge key by key; arrays and scalars in `overrides` replace the base value. */
function mergeDeep(base: unknown, overrides: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    return overrides;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(overrides)) {
    merged[key] = key in base ? mergeDeep(base[key], overrideValue) : overrideValue;
  }
  return merged;
}

/**
 * The preset named by `selection` with its overrides deep-merged in, validated by the full preset
 * schema so an override cannot leave the style out of range. Throws naming the preset, or the
 * invalid override path, and never returns a partial style.
 */
export function resolveStyle(
  presets: ReadonlyMap<string, Preset>,
  selection: StyleSelection,
): Preset {
  const base = presets.get(selection.preset);
  if (base === undefined) {
    const known = [...presets.keys()].join(", ");
    throw new Error(`Unknown style preset "${selection.preset}"; known presets: ${known}`);
  }
  if (selection.overrides === undefined) {
    return base;
  }
  const overrides = presetOverridesSchema.safeParse(selection.overrides);
  if (!overrides.success) {
    throw new Error(`Invalid style overrides: ${overrides.error.message}`, {
      cause: overrides.error,
    });
  }
  const resolved = presetSchema.safeParse(mergeDeep(base, overrides.data));
  if (!resolved.success) {
    throw new Error(
      `Style overrides leave preset "${selection.preset}" invalid: ${resolved.error.message}`,
      {
        cause: resolved.error,
      },
    );
  }
  return resolved.data;
}
