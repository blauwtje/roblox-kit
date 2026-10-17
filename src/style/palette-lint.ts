import { config } from "../config.ts";
import type { LookIssue } from "../map/look-lint.ts";
import { srgbToOklab } from "../vision/oklab.ts";
import type { Preset } from "./preset-schema.ts";

export const paletteIssueKinds = ["palette", "value"] as const;

/**
 * A palette finding in the shape of a `LookIssue`, with its own kinds: `build_map` merges both
 * lists and its output enum is built from `lookIssueKinds` and `paletteIssueKinds`. `zone` is the
 * surface role, slot or role pair the finding lies in, since a preset has no rooms.
 */
export type PaletteIssue = Omit<LookIssue, "kind"> & { kind: (typeof paletteIssueKinds)[number] };

import type { Oklab } from "../vision/oklab.ts";
export type { Oklab };

/** Roles that must read apart by lightness: the four that fill a room's shell. */
const separatedRoles = ["floor", "wall", "ceiling", "trim"] as const;

/** A `#rrggbb` color in OKLab. */
export function hexToOklab(hex: string): Oklab {
  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return srgbToOklab(channel(1), channel(3), channel(5));
}

export function oklabLightness(hex: string): number {
  return hexToOklab(hex).l;
}

/** Euclidean distance of two `#rrggbb` colors in OKLab. */
export function oklabDistance(first: string, second: string): number {
  const one = hexToOklab(first);
  const two = hexToOklab(second);
  return Math.hypot(one.l - two.l, one.a - two.a, one.b - two.b);
}

/** The lint palette: the preset's surface, prop slot and accent colors. `palette.colors` is not read. */
export function lintPaletteColors(preset: Preset): string[] {
  return [
    ...Object.values(preset.surfaces).map((surface) => surface.color),
    ...Object.values(preset.propSlots).map((look) => look.color),
    preset.palette.accent,
  ];
}

/** One `palette` issue per labeled color that is not within `paletteMatchDistance` of a lint palette color. */
export function lintColorsAgainstPalette(
  colors: Record<string, string>,
  preset: Preset,
): PaletteIssue[] {
  const palette = lintPaletteColors(preset);
  const issues: PaletteIssue[] = [];
  for (const [label, color] of Object.entries(colors)) {
    const nearest = Math.min(...palette.map((member) => oklabDistance(color, member)));
    if (nearest > config.lookLint.paletteMatchDistance) {
      issues.push({
        kind: "palette",
        zone: label,
        detail: `${label} color ${color} is outside the preset palette (nearest palette color is ${nearest.toFixed(3)} away in OKLab).`,
      });
    }
  }
  return issues;
}

/** Floor, wall, ceiling and trim against each other by lightness; surface and slot colors are the palette itself. */
export function lintPalette(preset: Preset): PaletteIssue[] {
  const issues: PaletteIssue[] = [];
  for (const [index, first] of separatedRoles.entries()) {
    for (const second of separatedRoles.slice(index + 1)) {
      const firstLightness = oklabLightness(preset.surfaces[first].color);
      const secondLightness = oklabLightness(preset.surfaces[second].color);
      const gap = Math.abs(firstLightness - secondLightness);
      if (gap < config.lookLint.minValueSeparation) {
        issues.push({
          kind: "value",
          zone: `${first}/${second}`,
          detail: `${first} and ${second} differ by only ${gap.toFixed(3)} in OKLab lightness (minimum ${String(config.lookLint.minValueSeparation)}), so they read as one tone.`,
        });
      }
    }
  }
  return issues;
}
