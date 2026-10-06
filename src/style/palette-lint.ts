import { config } from "../config.ts";
import type { LookIssue } from "../map/look-lint.ts";
import type { Preset } from "./preset-schema.ts";

export const paletteIssueKinds = ["palette", "value"] as const;

/**
 * A palette finding in the shape of a `LookIssue`, with its own kinds: `build_map` merges both
 * lists and its output enum is built from `lookIssueKinds` and `paletteIssueKinds`. `zone` is the
 * surface role, slot or role pair the finding lies in, since a preset has no rooms.
 */
export type PaletteIssue = Omit<LookIssue, "kind"> & { kind: (typeof paletteIssueKinds)[number] };

export interface Oklab {
  /** Lightness, 0 black to 1 white. */
  l: number;
  a: number;
  b: number;
}

/** Roles that must read apart by lightness: the four that fill a room's shell. */
const separatedRoles = ["floor", "wall", "ceiling", "trim"] as const;

function linearChannel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** A `#rrggbb` color in OKLab (Ottosson's matrices, linear sRGB input). */
export function hexToOklab(hex: string): Oklab {
  const red = linearChannel(hex, 1);
  const green = linearChannel(hex, 3);
  const blue = linearChannel(hex, 5);
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return {
    l: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    a: 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    b: 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  };
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

/** One `palette` issue per labeled color that is not within `paletteMatchDistance` of a palette or accent color. */
export function lintColorsAgainstPalette(
  colors: Record<string, string>,
  preset: Preset,
): PaletteIssue[] {
  const palette = [...preset.palette.colors, preset.palette.accent];
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

/** The preset's surface and prop slot colors against its palette, and floor, wall, ceiling and trim against each other by lightness. */
export function lintPalette(preset: Preset): PaletteIssue[] {
  const entries: [string, string][] = [
    ...Object.entries(preset.surfaces).map(([role, surface]): [string, string] => [
      role,
      surface.color,
    ]),
    ...Object.entries(preset.propSlots).map(([slot, look]): [string, string] => [
      `${slot} slot`,
      look.color,
    ]),
  ];
  const colors = Object.fromEntries(entries);
  const issues = lintColorsAgainstPalette(colors, preset);
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
