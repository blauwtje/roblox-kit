import assert from "node:assert/strict";
import { test } from "node:test";
import { planMap } from "../map/build-plan.ts";
import { relationMapSpecSchema } from "../map/map-spec.ts";
import { config } from "../config.ts";
import { loadPresets } from "./load-preset.ts";
import { lintPalette, oklabLightness } from "./palette-lint.ts";
import {
  heroParts,
  roleTexelDensity,
  texelDensity,
  type HeroShapeOperation,
} from "./preset-schema.ts";

const genreNames = ["cozy-town", "horror-facility", "sci-fi-station", "train-station"];

const featurePresets = ["train-station", "cozy-town", "horror-facility", "sci-fi-station"];

/** Names in Enum.Material that these presets may use; "built-in Materials only" means no custom ones. */
const builtInMaterials = new Set([
  "Brick",
  "CeramicTiles",
  "Concrete",
  "DiamondPlate",
  "Fabric",
  "Granite",
  "Limestone",
  "Marble",
  "Metal",
  "Neon",
  "Plaster",
  "Slate",
  "SmoothPlastic",
  "Wood",
  "WoodPlanks",
]);

await test("the bundled presets folder holds the four genre presets", async () => {
  const presets = await loadPresets();
  assert.deepEqual([...presets.keys()], genreNames);
});

await test("every bundled preset uses built-in Materials only and gives every MaterialVariant four maps", async () => {
  const presets = await loadPresets();
  for (const [name, preset] of presets) {
    for (const [role, surface] of Object.entries(preset.surfaces)) {
      assert.ok(builtInMaterials.has(surface.material), `${name} ${role}: ${surface.material}`);
      // A variant without texture maps renders flat color and hides the material's texture.
      if (surface.variant !== undefined) {
        assert.ok(
          surface.variant.maps !== undefined,
          `${name} ${role} has a MaterialVariant without maps`,
        );
      }
    }
  }
});

await test("every role variant tiles at its role's texel density and sets MaterialPattern by surface", async () => {
  const presets = await loadPresets();
  const organicPatterns = new Set(["brick", "concrete"]);
  for (const [name, preset] of presets) {
    for (const [role, surface] of Object.entries(preset.surfaces)) {
      const { variant, texture } = surface;
      if (variant === undefined || texture === undefined) {
        continue;
      }
      const label = `${name} ${role}`;
      assert.equal(variant.studsPerTile, texture.studsPerTile, `${label} tile size`);
      const target = roleTexelDensity[role as keyof typeof roleTexelDensity];
      const density = texelDensity(variant.studsPerTile);
      assert.ok(
        Math.abs(density - target) <= target * 0.1,
        `${label}: ${String(density)} px/stud, target ${String(target)}`,
      );
      const expected = organicPatterns.has(texture.pattern) ? "Organic" : "Regular";
      assert.equal(variant.materialPattern, expected, `${label} ${texture.pattern} pattern`);
    }
  }
});

await test("every bundled preset meets the size rules check_map enforces", async () => {
  const presets = await loadPresets();
  for (const [name, preset] of presets) {
    assert.ok(preset.sizeRules.minDoorwayWidth >= 10, `${name} doorway`);
    assert.ok(preset.sizeRules.minHallwayWidth >= 10, `${name} hallway`);
    assert.ok(preset.sizeRules.minWallHeight >= 10, `${name} wall height`);
  }
});

const featureRoomSizes: Record<string, number> = {
  "train-station": 50,
  "cozy-town": 46,
  "horror-facility": 18,
};

for (const name of featurePresets) {
  const size = featureRoomSizes[name] ?? 50;
  const featureRoom = { name: "hall", x: 0, z: 0, width: size, depth: size, spawn: true };
  await test(`${name} builds a map with no look issues and sets the full upload-free feature set`, async () => {
    const preset = (await loadPresets()).get(name);
    assert.ok(preset !== undefined, name);
    assert.ok(preset.lightFixtures !== undefined, `${name} lightFixtures`);
    assert.ok(preset.lighting.PostProcessing !== undefined, `${name} PostProcessing`);
    assert.ok((preset.ambientEffects ?? []).length > 0, `${name} ambientEffects`);
    assert.ok(Object.keys(preset.idleAnimations ?? {}).length > 0, `${name} idleAnimations`);
    const plan = await planMap(
      {
        ...relationMapSpecSchema.parse({
          mapId: `${name}-quality`,
          rooms: [featureRoom],
          style: { preset: name },
        }),
        useRecordedAssets: false,
      },
      {},
    );
    assert.deepEqual(plan.lookIssues, [], name);
  });
}

type Axis = "x" | "y" | "z";
type Bounds = Record<Axis, { min: number; max: number }>;

/** A cylinder-like part's extent from its center: `low` to `high` along its axis, `radius` on the other two. */
function roundBounds(axis: Axis, radius: number, low: number, high: number): Bounds {
  const across = { min: -radius, max: radius };
  const along = { min: low, max: high };
  return {
    x: axis === "x" ? along : across,
    y: axis === "y" ? along : across,
    z: axis === "z" ? along : across,
  };
}

/** The shape's extent from its own center, array copies excluded; bevels and cuts only remove material, so they are ignored. */
function shapeBounds(shape: HeroShapeOperation): Bounds {
  switch (shape.op) {
    case "box":
      return {
        x: { min: -shape.size.width / 2, max: shape.size.width / 2 },
        y: { min: -shape.size.height / 2, max: shape.size.height / 2 },
        z: { min: -shape.size.depth / 2, max: shape.size.depth / 2 },
      };
    case "cylinder":
      return roundBounds(shape.axis, shape.radius, -shape.length / 2, shape.length / 2);
    case "lathe":
      return roundBounds(
        shape.axis,
        Math.max(...shape.points.map((point) => point.radius)),
        Math.min(...shape.points.map((point) => point.offset)),
        Math.max(...shape.points.map((point) => point.offset)),
      );
    case "sweep": {
      // Each path point carries the section turned to face along the path, so it reaches at most the
      // section's farthest corner from the section origin in any direction.
      const reach = Math.max(...shape.section.map((corner) => Math.hypot(corner.x, corner.y)));
      const reachAlong = (axis: Axis) => ({
        min: Math.min(...shape.path.map((point) => point[axis])) - reach,
        max: Math.max(...shape.path.map((point) => point[axis])) + reach,
      });
      return { x: reachAlong("x"), y: reachAlong("y"), z: reachAlong("z") };
    }
    case "profile":
      return {
        x: {
          min: Math.min(...shape.points.map((point) => point.x)),
          max: Math.max(...shape.points.map((point) => point.x)),
        },
        y: {
          min: Math.min(...shape.points.map((point) => point.y)),
          max: Math.max(...shape.points.map((point) => point.y)),
        },
        z: { min: -shape.depth / 2, max: shape.depth / 2 },
      };
  }
}

await test("every part of each hero prop lies inside the prop's size", async () => {
  const heroProps = (await loadPresets()).get("train-station")?.heroProps;
  assert.ok(heroProps !== undefined);
  for (const [kind, heroProp] of Object.entries(heroProps)) {
    const { width, height, depth } = heroProp.size;
    for (const part of heroParts(heroProp.operations)) {
      const bounds = shapeBounds(part.shape);
      // The array's first copy stays on `center`, the last sits `step * (count - 1)` further.
      const copies = part.array === undefined ? 0 : part.array.count - 1;
      const shift = {
        x: (part.array?.step.x ?? 0) * copies,
        y: (part.array?.step.y ?? 0) * copies,
        z: (part.array?.step.z ?? 0) * copies,
      };
      for (const axis of ["x", "y", "z"] as const) {
        const first = part.shape.center[axis] + bounds[axis].min;
        const last = part.shape.center[axis] + bounds[axis].max;
        const low = Math.min(first, first + shift[axis]);
        const high = Math.max(last, last + shift[axis]);
        const [floor, ceiling] =
          axis === "y"
            ? [0, height]
            : [-(axis === "x" ? width : depth) / 2, (axis === "x" ? width : depth) / 2];
        assert.ok(
          low >= floor - 1e-9,
          `${kind}: ${part.shape.op} part exceeds the ${axis} minimum`,
        );
        assert.ok(
          high <= ceiling + 1e-9,
          `${kind}: ${part.shape.op} part exceeds the ${axis} maximum`,
        );
      }
    }
  }
});

await test("every shape of every hero prop in every preset has a bevel", async () => {
  for (const [name, preset] of await loadPresets()) {
    for (const [kind, heroProp] of Object.entries(preset.heroProps ?? {})) {
      for (const part of heroParts(heroProp.operations)) {
        assert.ok(part.shape.bevel !== undefined, `${name} ${kind}: ${part.shape.op} has no bevel`);
      }
    }
  }
});

await test("every bundled preset keeps floor, wall, ceiling and trim apart in OKLab lightness and its surfaces in its palette", async () => {
  const presets = await loadPresets();
  const roles = ["floor", "wall", "ceiling", "trim"] as const;
  for (const [name, preset] of presets) {
    for (const [index, first] of roles.entries()) {
      for (const second of roles.slice(index + 1)) {
        const gap = Math.abs(
          oklabLightness(preset.surfaces[first].color) -
            oklabLightness(preset.surfaces[second].color),
        );
        assert.ok(
          gap >= config.lookLint.minValueSeparation,
          `${name} ${first}/${second}: ${gap.toFixed(3)} under ${String(config.lookLint.minValueSeparation)}`,
        );
      }
    }
    assert.deepEqual(lintPalette(preset), [], name);
  }
});
