import type { AmbientEffectRecord } from "./ambient-effects.ts";
import type { FacadePart } from "./facade-grammar.ts";
import type { PartRecord } from "./map-layout.ts";
import type { PropRecord } from "./prop-placement.ts";
import type { DetailPart } from "./room-details.ts";

/** The seven build phases in the order `build_map` runs them. */
export const buildPhaseNames = [
  "shell",
  "floors and ceilings",
  "openings",
  "surfaces",
  "props",
  "lighting",
  "ambient effects",
] as const;

export type BuildPhaseName = (typeof buildPhaseNames)[number];

/** What the phases group: the layout's parts, the decorative details, the props, the lights and the ambient effects. */
export interface BuildPhaseInputs<Light> {
  parts: PartRecord[];
  details: DetailPart[];
  /** The facades of exterior rooms; absent means none. */
  facades?: FacadePart[];
  props: PropRecord[];
  lights: Light[];
  /** The ambient particles and beams; absent means none. */
  effects?: AmbientEffectRecord[];
}

/** One phase: its name and everything it builds, so a phase's `parts.length` is its part count. */
export interface BuildPhase<Light> {
  name: BuildPhaseName;
  parts: (PartRecord | DetailPart | FacadePart | PropRecord | Light | AmbientEffectRecord)[];
}

/**
 * Groups a layout into the seven ordered phases, every part in exactly one phase:
 * walls are the shell; floors, spawns and ceilings form the second phase; doorway arches are the openings;
 * the other details (baseboards, crowns, stripes, pillars) and the facades of exterior rooms are the surfaces; then props, lights and ambient effects.
 * A phase with nothing to build stays in the array with no parts.
 */
export function groupBuildPhases<Light>(inputs: BuildPhaseInputs<Light>): BuildPhase<Light>[] {
  const { parts, details, facades = [], props, lights, effects = [] } = inputs;
  const partsOfKind = (kinds: PartRecord["kind"][]) =>
    parts.filter((part) => kinds.includes(part.kind));
  const groups: Record<BuildPhaseName, BuildPhase<Light>["parts"]> = {
    shell: partsOfKind(["wall"]),
    "floors and ceilings": partsOfKind(["floor", "spawn", "ceiling"]),
    openings: details.filter((detail) => detail.kind === "arch"),
    surfaces: [...details.filter((detail) => detail.kind !== "arch"), ...facades],
    props,
    lighting: lights,
    "ambient effects": effects,
  };
  return buildPhaseNames.map((name) => ({ name, parts: groups[name] }));
}
