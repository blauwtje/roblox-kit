import { propDimensions, propKinds, type PropKind } from "../map/prop-placement.ts";
import type { HeroShapeOperation, Preset } from "../style/preset-schema.ts";

type HeroPropRecipe = NonNullable<Preset["heroProps"]>[string];
type Role = HeroShapeOperation["role"];
type Operation = HeroPropRecipe["operations"][number];

/** Prefix of a prop kind's recipe key, so it never clashes with a preset's own hero kind of the same name. */
const propRecipePrefix = "prop-";

/** Triangles each prop-kind mesh may hold: a prop repeats in a room, so it stays well under a hero's budget. */
const propTriangleBudget = 2000;

/** Height a pillar's recipe is built at; the build stretches it to the wall it stands against. */
const pillarRecipeHeight = 12;

/** A box whose bottom face is `bottom` studs above the floor, centered on `x` across and `z` along the depth. */
function box(
  phase: Operation["phase"],
  role: Role,
  at: { x?: number; bottom: number; z?: number },
  size: { width: number; height: number; depth: number },
): Operation {
  return {
    op: "box",
    phase,
    role,
    center: { x: at.x ?? 0, y: at.bottom + size.height / 2, z: at.z ?? 0 },
    size,
  };
}

/** An upright cylinder from `bottom` to `bottom + length`. */
function post(
  role: Role,
  at: { x?: number; bottom: number; z?: number },
  radius: number,
  length: number,
): Operation {
  return {
    op: "cylinder",
    phase: "structure",
    role,
    center: { x: at.x ?? 0, y: at.bottom + length / 2, z: at.z ?? 0 },
    radius,
    length,
    axis: "y",
    segments: 12,
  };
}

/** A copy of the piece before it every `step` studs, `count` times, in that piece's phase. */
function array(
  count: number,
  step: { x?: number; y?: number; z?: number },
  phase: Operation["phase"] = "structure",
): Operation {
  return {
    op: "array",
    phase,
    count,
    step: { x: step.x ?? 0, y: step.y ?? 0, z: step.z ?? 0 },
  };
}

/** The recipe size of a prop kind: its placement box, the pillar at its nominal height. */
function sizeOf(kind: PropKind): { width: number; height: number; depth: number } {
  const dimensions = propDimensions[kind];
  const height = "y" in dimensions ? dimensions.y : pillarRecipeHeight;
  return { width: dimensions.x, height, depth: dimensions.z };
}

/** The operations of each prop kind, each filling exactly the kind's box so the size check holds. */
function operationsOf(kind: PropKind): Operation[] {
  const { width: w, height: h, depth: d } = sizeOf(kind);
  switch (kind) {
    case "bench":
      return [
        box("blockout", "trim", { bottom: 1.2 }, { width: w, height: 0.4, depth: d }),
        box(
          "structure",
          "accent",
          { x: -w / 2 + 0.3, bottom: 0 },
          { width: 0.6, height: 1.2, depth: d },
        ),
        array(2, { x: w - 0.6 }),
        box(
          "form",
          "trim",
          { bottom: 1.6, z: d / 2 - 0.2 },
          { width: w, height: h - 1.6, depth: 0.4 },
        ),
      ];
    case "lamp":
      return [
        box("blockout", "trim", { bottom: 0 }, { width: w, height: 0.4, depth: d }),
        post("trim", { bottom: 0.4 }, 0.2, h - 1.6),
        box("form", "accent", { bottom: h - 1.2 }, { width: w, height: 1.2, depth: d }),
      ];
    case "pillar":
      return [
        box("blockout", "trim", { bottom: 0 }, { width: w, height: 0.6, depth: d }),
        box(
          "structure",
          "wall",
          { bottom: 0.6 },
          { width: w * 0.8, height: h - 1.2, depth: d * 0.8 },
        ),
        box("form", "trim", { bottom: h - 0.6 }, { width: w, height: 0.6, depth: d }),
      ];
    case "stairs":
      return [
        box(
          "blockout",
          "floor",
          { bottom: 0, z: -d / 2 + 2 / 3 },
          { width: w, height: h / 3, depth: 4 / 3 },
        ),
        array(3, { y: h / 3, z: 4 / 3 }),
        box(
          "structure",
          "floor",
          { bottom: 0, z: d / 6 },
          { width: w, height: h / 3, depth: (d * 2) / 3 },
        ),
        box(
          "structure",
          "floor",
          { bottom: h / 3, z: d / 3 },
          { width: w, height: h / 3, depth: d / 3 },
        ),
      ];
    case "rail":
      return [
        post("trim", { x: -w / 2 + 0.25, bottom: 0 }, 0.25, h - 0.3),
        array(5, { x: (w - 0.5) / 4 }),
        box("form", "accent", { bottom: h - 0.3 }, { width: w, height: 0.3, depth: d }),
      ];
    case "track-bed":
      return [
        box("blockout", "floor", { bottom: 0 }, { width: w, height: h * 0.5, depth: d }),
        box(
          "structure",
          "trim",
          { x: -w / 2 + 0.4, bottom: h * 0.5 },
          { width: 0.8, height: h * 0.25, depth: d },
        ),
        array(10, { x: (w - 0.8) / 9 }),
        box(
          "form",
          "accent",
          { bottom: h * 0.75, z: -d / 4 },
          { width: w, height: h * 0.25, depth: 0.3 },
        ),
        array(2, { z: d / 2 }, "form"),
      ];
    case "platform-edge":
      return [
        box("blockout", "floor", { bottom: 0, z: -d / 4 }, { width: w, height: h, depth: d / 2 }),
        box("form", "accent", { bottom: 0, z: d / 4 }, { width: w, height: h, depth: d / 2 }),
      ];
    case "counter":
    case "ticket-counter":
    case "lab-bench":
      return [
        box("blockout", "wall", { bottom: 0 }, { width: w, height: h - 0.3, depth: d - 0.2 }),
        box("form", "trim", { bottom: h - 0.3 }, { width: w, height: 0.3, depth: d }),
      ];
    case "sign":
      return [
        box("blockout", "trim", { bottom: 0 }, { width: w, height: h, depth: d / 2 }),
        box(
          "form",
          "accent",
          { bottom: 0.3, z: d / 4 },
          { width: w - 0.6, height: h - 0.6, depth: d / 2 },
        ),
      ];
    case "cell-bars":
      return [
        box("blockout", "trim", { bottom: 0 }, { width: w, height: 0.5, depth: d }),
        post("trim", { x: -w / 2 + 0.25, bottom: 0.5 }, 0.15, h - 1),
        array(9, { x: (w - 0.5) / 8 }),
        box("form", "trim", { bottom: h - 0.5 }, { width: w, height: 0.5, depth: d }),
      ];
    case "control-console":
      return [
        box("blockout", "wall", { bottom: 0 }, { width: w, height: h - 1, depth: d }),
        box("form", "accent", { bottom: h - 1, z: d / 4 }, { width: w, height: 1, depth: d / 2 }),
      ];
    case "crate-stack":
      return [
        box(
          "blockout",
          "trim",
          { x: -w / 4, bottom: 0 },
          { width: w / 2, height: h / 2, depth: d },
        ),
        array(2, { x: w / 2 }),
        box(
          "structure",
          "trim",
          { x: -w / 4, bottom: h / 2 },
          { width: w / 2, height: h / 2, depth: d },
        ),
      ];
    case "fireplace":
      return [
        box("blockout", "wall", { bottom: 0 }, { width: w, height: h - 0.5, depth: d }),
        {
          op: "cut",
          phase: "blockout",
          center: { x: 0, y: -(h - 0.5) / 2 + 1.25, z: -d / 4 },
          size: { width: w / 2, height: 2.5, depth: d / 2 },
        },
        box("form", "trim", { bottom: h - 0.5 }, { width: w, height: 0.5, depth: d }),
      ];
    case "departure-board":
      return [
        post("trim", { x: -w / 2 + 0.5, bottom: 0 }, 0.5, h - 4),
        array(2, { x: w - 1 }),
        box("form", "accent", { bottom: h - 4 }, { width: w, height: 4, depth: d }),
      ];
    case "clock":
      return [
        post("trim", { bottom: 0 }, 0.6, h - w),
        box("form", "accent", { bottom: h - w }, { width: w, height: w, depth: d }),
      ];
    case "ticket-machine":
      return [
        box("blockout", "wall", { bottom: 0 }, { width: w, height: h, depth: d - 0.2 }),
        box(
          "form",
          "accent",
          { bottom: h / 2, z: d / 2 - 0.1 },
          { width: w - 0.6, height: h / 3, depth: 0.2 },
        ),
      ];
  }
}

/** The recipe key of a prop kind's mesh: `prop-<kind>`. */
export function propRecipeKind(kind: PropKind): string {
  return `${propRecipePrefix}${kind}`;
}

/**
 * One Blender recipe per prop kind in `propKinds`, keyed `prop-<kind>`, replacing that kind's set piece and as
 * big as its placement box. A kind whose recipe hash has no recorded asset keeps its Luau model.
 */
export const propRecipes: Readonly<Record<string, HeroPropRecipe>> = Object.freeze(
  Object.fromEntries(
    propKinds.map((kind) => [
      propRecipeKind(kind),
      {
        description: `The ${kind} prop as one mesh per surface role.`,
        replaces: kind,
        size: sizeOf(kind),
        triangleBudget: propTriangleBudget,
        operations: operationsOf(kind),
      },
    ]),
  ),
);

/** The recipe of `kind` for `preset`: its own hero prop, else a prop kind's recipe; undefined when neither has it. */
export function heroRecipeOf(preset: Preset, kind: string): HeroPropRecipe | undefined {
  return preset.heroProps?.[kind] ?? propRecipes[kind];
}

/** The prop-kind recipe keys a preset can place: one per kind in its prop kit. */
export function propRecipeKindsOf(preset: Preset): string[] {
  return preset.propKit
    .filter((name) => propRecipes[`${propRecipePrefix}${name}`] !== undefined)
    .map((name) => `${propRecipePrefix}${name}`);
}
