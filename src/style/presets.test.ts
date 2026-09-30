import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { placeArrangements } from "../map/arrangement-placement.ts";
import { relationMapSpecSchema } from "../map/map-spec.ts";
import { resolveRelations } from "../map/relation-solver.ts";
import { placeSetPieces } from "../map/set-piece-placement.ts";
import { doorwayClearanceBoxes } from "../map/size-rules.ts";
import { loadPresets } from "./load-preset.ts";

const genreNames = ["cozy-town", "horror-facility", "sci-fi-station", "train-station"];

/** Names in Enum.Material that these presets may use; "built-in Materials only" means no custom ones. */
const builtInMaterials = new Set([
  "Brick",
  "Concrete",
  "DiamondPlate",
  "Fabric",
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

await test("every bundled preset uses built-in Materials only and sets no MaterialVariant", async () => {
  const presets = await loadPresets();
  for (const [name, preset] of presets) {
    for (const [role, surface] of Object.entries(preset.surfaces)) {
      assert.ok(builtInMaterials.has(surface.material), `${name} ${role}: ${surface.material}`);
      // A variant without texture maps renders flat color and hides the material's texture.
      assert.equal(surface.variant, undefined, `${name} ${role} sets a MaterialVariant`);
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

const minPiecesPerQuadrant = 2;

/** The train station preset with the eval benchmark map resolved and its set pieces placed. */
async function placeBenchmarkSetPieces() {
  const preset = (await loadPresets()).get("train-station");
  assert.ok(preset !== undefined);
  const benchmark = new URL("../../eval/benchmarks/train-station.json", import.meta.url);
  const spec = resolveRelations(
    relationMapSpecSchema.parse(JSON.parse(await readFile(benchmark, "utf8"))),
  );
  const seed = spec.seed ?? 0;
  const agent = { radius: preset.sizeRules.agentRadius, height: preset.sizeRules.agentHeight };
  const { pieces } = placeSetPieces(
    spec,
    preset.roomTypes,
    preset.palette.accent,
    seed,
    doorwayClearanceBoxes(spec, agent),
  );
  return { preset, spec, seed, setPieces: pieces };
}

await test("the train station's concourse and ticket hall arrange at least two pieces in each quarter of the floor", async () => {
  const { preset, spec, seed, setPieces } = await placeBenchmarkSetPieces();
  const { pieces } = placeArrangements(spec, preset.roomTypes, setPieces, seed);
  for (const roomName of ["concourse", "ticket-hall"]) {
    const room = spec.rooms.find((candidate) => candidate.name === roomName);
    assert.ok(room !== undefined, roomName);
    const inRoom = pieces.filter(
      (piece) =>
        Math.abs(piece.pivot.x - room.x) <= room.width / 2 &&
        Math.abs(piece.pivot.z - room.z) <= room.depth / 2,
    );
    for (const sideOfX of [-1, 1]) {
      for (const sideOfZ of [-1, 1]) {
        const inQuadrant = inRoom.filter(
          (piece) =>
            (piece.pivot.x - room.x) * sideOfX > 1 && (piece.pivot.z - room.z) * sideOfZ > 1,
        );
        assert.ok(
          inQuadrant.length >= minPiecesPerQuadrant,
          `${roomName}: ${String(inQuadrant.length)} pieces in quadrant x${String(sideOfX)} z${String(sideOfZ)}`,
        );
      }
    }
  }
});

await test("the platform's train car replaces its track bed and fits the track bed's span", async () => {
  const { preset, setPieces } = await placeBenchmarkSetPieces();
  const trainCar = preset.heroProps?.["train-car"];
  assert.ok(trainCar !== undefined);
  assert.equal(trainCar.replaces, "track-bed");
  assert.deepEqual(preset.roomTypes?.["platform"]?.heroProps, ["train-car"]);
  const trackBed = setPieces.find((piece) => piece.kind === "track-bed");
  assert.ok(trackBed !== undefined);
  assert.ok(
    trainCar.size.width <= trackBed.size.x,
    `car ${String(trainCar.size.width)} studs long, track bed ${String(trackBed.size.x)}`,
  );
  assert.ok(trainCar.size.depth <= trackBed.size.z, "the car stands within the track bed's depth");
});

/** Half the extent of a cylinder along each axis: half its length on its axis, its radius on the other two. */
function cylinderHalfExtent(cylinder: { radius: number; length: number; axis: "x" | "y" | "z" }) {
  const along = cylinder.length / 2;
  return {
    x: cylinder.axis === "x" ? along : cylinder.radius,
    y: cylinder.axis === "y" ? along : cylinder.radius,
    z: cylinder.axis === "z" ? along : cylinder.radius,
  };
}

await test("every part of the train car lies inside the car's size", async () => {
  const trainCar = (await loadPresets()).get("train-station")?.heroProps?.["train-car"];
  assert.ok(trainCar !== undefined);
  const { width, height, depth } = trainCar.size;
  for (const part of trainCar.parts) {
    const half =
      part.shape === "box"
        ? { x: part.size.width / 2, y: part.size.height / 2, z: part.size.depth / 2 }
        : part.shape === "cylinder"
          ? cylinderHalfExtent(part)
          : undefined;
    assert.ok(half !== undefined, `${part.shape} part is not checked`);
    assert.ok(Math.abs(part.center.x) + half.x <= width / 2 + 1e-9, "part exceeds the width");
    assert.ok(part.center.y - half.y >= -1e-9, "part sinks below the floor");
    assert.ok(part.center.y + half.y <= height + 1e-9, "part exceeds the height");
    assert.ok(Math.abs(part.center.z) + half.z <= depth / 2 + 1e-9, "part exceeds the depth");
  }
});
