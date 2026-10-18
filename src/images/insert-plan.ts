import { imagesConfig } from "./images-config.ts";
import type { FlipbookLayout } from "./flipbook.ts";
import { nineSliceManifest, type SliceCenter } from "./nine-slice.ts";

export const buttonMinPixels = 48;
export const maxFlipbookFramerate = 30;
const faces = ["Front", "Back", "Top", "Bottom", "Left", "Right"] as const;
const layouts = ["Grid2x2", "Grid4x4", "Grid8x8"] as const;

export type InsertKind = "label" | "button" | "surface" | "particle";

/** One image to insert. `parent` is a dot path from `game`, e.g. `Workspace.Map.Sign`. */
export interface InsertEntry {
  kind: InsertKind;
  name: string;
  image: string;
  parent: string;
  width: number;
  height: number;
  scale?: { x: number; y: number };
  slice?: SliceCenter;
  face?: (typeof faces)[number];
  layout?: FlipbookLayout;
  framerate?: number;
}

export interface InsertPlan {
  screenGui: { name: string; screenInsets: "CoreUISafeInsets" };
  entries: PlannedEntry[];
}

export interface PlannedEntry {
  kind: InsertKind;
  name: string;
  image: string;
  parent: string;
  aspectRatio?: number;
  scale?: { x: number; y: number };
  slice?: { center: SliceCenter; sliceScale: 0.5 };
  minPixels?: number;
  face?: string;
  layout?: string;
  framerate?: number;
}

function planScreen(entry: InsertEntry): Partial<PlannedEntry> {
  const scale = entry.scale ?? { x: 0.2, y: 0.2 };
  if (!(scale.x > 0 && scale.x <= 1 && scale.y > 0 && scale.y <= 1)) {
    throw new Error(`${entry.name}: scale must be above 0 and at most 1 on each axis.`);
  }
  const planned: Partial<PlannedEntry> = { aspectRatio: entry.width / entry.height, scale };
  if (entry.slice) {
    const manifest = nineSliceManifest(entry.width, entry.height, entry.slice);
    planned.slice = { center: manifest.sliceCenter, sliceScale: manifest.sliceScale };
  }
  if (entry.kind === "button") planned.minPixels = buttonMinPixels;
  return planned;
}

function planSurface(entry: InsertEntry): Partial<PlannedEntry> {
  const face = entry.face ?? "Front";
  if (!faces.includes(face)) throw new Error(`${entry.name}: unknown face ${face}.`);
  return { face };
}

function planParticle(entry: InsertEntry): Partial<PlannedEntry> {
  const { layout, framerate = 12 } = entry;
  if (!layout || !layouts.includes(layout)) {
    throw new Error(`${entry.name}: layout must be one of ${layouts.join(", ")}.`);
  }
  if (!(framerate > 0 && framerate <= maxFlipbookFramerate)) {
    throw new Error(
      `${entry.name}: framerate must be above 0 and at most ${String(maxFlipbookFramerate)}.`,
    );
  }
  return { layout, framerate };
}

function planEntry(entry: InsertEntry): PlannedEntry {
  if (!/^rbxassetid:\/\/\d+$/.test(entry.image)) {
    throw new Error(`${entry.name}: image must look like rbxassetid://<id>.`);
  }
  if (!entry.name || !entry.parent) throw new Error("Each entry needs a name and a parent.");
  for (const side of [entry.width, entry.height]) {
    if (!Number.isInteger(side) || side <= 0 || side > imagesConfig.maxImagePixels) {
      throw new Error(
        `${entry.name}: image size must be whole pixels up to ${String(imagesConfig.maxImagePixels)}.`,
      );
    }
  }
  const { kind } = entry;
  const planners = {
    surface: planSurface,
    particle: planParticle,
    label: planScreen,
    button: planScreen,
  };
  const extra = planners[kind](entry);
  return { kind, name: entry.name, image: entry.image, parent: entry.parent, ...extra };
}

/** Validates the entries and fills in what Luau needs: ratios, slice data, minimum sizes, faces, flipbook settings. */
export function planInsert(entries: readonly InsertEntry[]): InsertPlan {
  return {
    screenGui: { name: "RobloxKitImages", screenInsets: "CoreUISafeInsets" },
    entries: entries.map(planEntry),
  };
}
