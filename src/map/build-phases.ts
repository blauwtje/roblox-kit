import type { PartRecord } from "./map-layout.ts";
import type { PropRecord } from "./prop-placement.ts";
import type { DetailPart } from "./room-details.ts";

/** The six build phases in the order `build_map` runs them. */
export const buildPhaseNames = [
  "shell",
  "floors and ceilings",
  "openings",
  "surfaces",
  "props",
  "lighting",
] as const;

export type BuildPhaseName = (typeof buildPhaseNames)[number];

/** What the phases group: the layout's parts, the decorative details, the props and the lights. */
export interface BuildPhaseInputs<Light> {
  parts: PartRecord[];
  details: DetailPart[];
  props: PropRecord[];
  lights: Light[];
}

/** One phase: its name and everything it builds, so a phase's `parts.length` is its part count. */
export interface BuildPhase<Light> {
  name: BuildPhaseName;
  parts: (PartRecord | DetailPart | PropRecord | Light)[];
}

/**
 * Groups a layout into the six ordered phases, every part in exactly one phase:
 * walls are the shell; floors, spawns and ceilings form the second phase; doorway arches are the openings;
 * the other details (baseboards, crowns, stripes, pillars) are the surfaces; then props and lights.
 * A phase with nothing to build stays in the array with no parts.
 */
export function groupBuildPhases<Light>(inputs: BuildPhaseInputs<Light>): BuildPhase<Light>[] {
  const { parts, details, props, lights } = inputs;
  const partsOfKind = (kinds: PartRecord["kind"][]) =>
    parts.filter((part) => kinds.includes(part.kind));
  const groups: Record<BuildPhaseName, BuildPhase<Light>["parts"]> = {
    shell: partsOfKind(["wall"]),
    "floors and ceilings": partsOfKind(["floor", "spawn", "ceiling"]),
    openings: details.filter((detail) => detail.kind === "arch"),
    surfaces: details.filter((detail) => detail.kind !== "arch"),
    props,
    lighting: lights,
  };
  return buildPhaseNames.map((name) => ({ name, parts: groups[name] }));
}
