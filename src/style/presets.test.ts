import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { placeLights } from "../lighting/light-placement.ts";
import { placeArrangements } from "../map/arrangement-placement.ts";
import { layoutMap } from "../map/map-layout.ts";
import { relationMapSpecSchema } from "../map/map-spec.ts";
import { propDimensions } from "../map/prop-placement.ts";
import { detailDimensions } from "../map/room-details.ts";
import { resolveRelations } from "../map/relation-solver.ts";
import { placeSetPieces } from "../map/set-piece-placement.ts";
import { doorwayClearanceBoxes, findDoorways } from "../map/size-rules.ts";
import { zoneShots } from "../map/zone-cameras.ts";
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

/** Names in Enum.Material that these presets may use; "built-in Materials only" means no custom ones. */
const builtInMaterials = new Set([
  "Brick",
  "CeramicTiles",
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
    preset.propRules,
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

await test("the concourse's departure board replaces its departure-board set piece and fits its span", async () => {
  const { preset, setPieces } = await placeBenchmarkSetPieces();
  const board = preset.heroProps?.["departure-board"];
  assert.ok(board !== undefined);
  assert.equal(board.replaces, "departure-board");
  assert.equal(preset.roomTypes?.["concourse"]?.heroProps, undefined);
  const setPiece = setPieces.find((piece) => piece.kind === "departure-board");
  assert.ok(setPiece !== undefined);
  assert.ok(board.size.width <= setPiece.size.x, `board ${String(board.size.width)} studs wide`);
  assert.ok(board.size.height <= setPiece.size.y, `board ${String(board.size.height)} studs high`);
});

/** The eye view's window shape for the centre-strip and pendant checks; Studio's default window is wider than tall. */
const eyeViewAspect = 16 / 9;

interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A piece's floor footprint; a quarter turn swaps its width and depth. */
function footprintOf(piece: {
  pivot: { x: number; z: number };
  size: { x: number; z: number };
  yaw?: number;
}): Footprint {
  const turned = Math.abs(Math.round(((piece.yaw ?? 0) % 180) / 90)) === 1;
  const halfX = (turned ? piece.size.z : piece.size.x) / 2;
  const halfZ = (turned ? piece.size.x : piece.size.z) / 2;
  return {
    minX: piece.pivot.x - halfX,
    maxX: piece.pivot.x + halfX,
    minZ: piece.pivot.z - halfZ,
    maxZ: piece.pivot.z + halfZ,
  };
}

/** The gap between two footprints, 0 when they touch or overlap. */
function footprintGap(first: Footprint, second: Footprint): number {
  const gapX = Math.max(first.minX - second.maxX, second.minX - first.maxX, 0);
  const gapZ = Math.max(first.minZ - second.maxZ, second.minZ - first.maxZ, 0);
  return Math.hypot(gapX, gapZ);
}

/** The benchmark map's set pieces, arrangements and pendants, with the concourse's walls and eye shot. */
async function placeBenchmarkConcourse() {
  const { preset, spec, seed, setPieces } = await placeBenchmarkSetPieces();
  const { pieces: arranged } = placeArrangements(spec, preset.roomTypes, setPieces, seed);
  const room = spec.rooms.find((candidate) => candidate.name === "concourse");
  assert.ok(room !== undefined);
  const inConcourse = (piece: { pivot: { x: number; z: number } }) =>
    Math.abs(piece.pivot.x - room.x) <= room.width / 2 &&
    Math.abs(piece.pivot.z - room.z) <= room.depth / 2;
  const wallHeight = room.wallHeight ?? spec.wallHeight ?? config.defaultWallHeightStuds;
  const eyeShot = zoneShots({
    name: room.name,
    bounds: {
      min: { x: room.x - room.width / 2, y: 0, z: room.z - room.depth / 2 },
      max: { x: room.x + room.width / 2, y: wallHeight, z: room.z + room.depth / 2 },
    },
  }).find((shot) => shot.view === "eye");
  assert.ok(eyeShot !== undefined);
  const southDoor = findDoorways(spec).find(
    (doorway) => doorway.room === room.name && doorway.side === "south",
  );
  assert.ok(southDoor !== undefined);
  return {
    preset,
    spec,
    room,
    eyeShot,
    southDoor,
    arranged: arranged.filter(inConcourse),
    setPieces: setPieces.filter(inConcourse),
  };
}

await test("the concourse has two pillar lines with a gap at the south door and none in the eye view's centre strip", async () => {
  const { arranged, eyeShot, southDoor } = await placeBenchmarkConcourse();
  const pillars = arranged.filter((piece) => piece.kind === "pillar");
  const lineZs = [...new Set(pillars.map((piece) => piece.pivot.z))];
  assert.equal(lineZs.length, 2, `pillar lines at z ${lineZs.join(", ")}`);
  const southLine = pillars.filter((piece) => piece.pivot.z > southDoor.position.z - 10);
  const northLine = pillars.filter((piece) => piece.pivot.z <= southDoor.position.z - 10);
  const doorHalf = southDoor.width / 2;
  assert.ok(
    southLine.every((piece) => Math.abs(piece.pivot.x - southDoor.position.x) > doorHalf),
    "no pillar in front of the south door",
  );
  assert.ok(
    northLine.some((piece) => Math.abs(piece.pivot.x - southDoor.position.x) <= doorHalf),
    "the line without a door runs on across the same stretch",
  );
  // The centre strip is the middle third of the eye view's horizontal angle; the camera looks along +Z.
  const halfHorizontalDegrees =
    (Math.atan(Math.tan((config.studioFieldOfViewDegrees * Math.PI) / 360) * eyeViewAspect) * 180) /
    Math.PI;
  const stripDegrees = halfHorizontalDegrees / 3;
  const [cameraX, , cameraZ] = eyeShot.cameraPosition;
  for (const pillar of pillars) {
    const footprint = footprintOf(pillar);
    const bearings = [footprint.minX, footprint.maxX].flatMap((x) =>
      [footprint.minZ, footprint.maxZ].map(
        (z) => (Math.atan2(x - cameraX, z - cameraZ) * 180) / Math.PI,
      ),
    );
    const inStrip = Math.min(...bearings) <= stripDegrees && Math.max(...bearings) >= -stripDegrees;
    assert.ok(!inStrip, `pillar at x ${String(pillar.pivot.x)} z ${String(pillar.pivot.z)}`);
  }
});

await test("the concourse's six ticket machines stand side by side on the east wall, clear of doors and pillars", async () => {
  const { room, arranged, southDoor } = await placeBenchmarkConcourse();
  const machines = arranged.filter((piece) => piece.kind === "ticket-machine");
  assert.equal(machines.length, 6);
  const footprints = machines.map(footprintOf);
  const eastFace = room.x + room.width / 2;
  const westFace = room.x - room.width / 2;
  const southFace = room.z + room.depth / 2;
  for (const footprint of footprints) {
    assert.ok(footprint.maxX > eastFace - 6 && footprint.maxX < eastFace, "against the east wall");
    assert.ok(footprint.maxX > (westFace + eastFace) / 2, "in the east half");
    assert.ok(footprint.maxZ < southFace - 1, "never on the south wall");
  }
  const ordered = [...footprints].sort((first, second) => first.minZ - second.minZ);
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = (ordered[index]?.minZ ?? 0) - (ordered[index - 1]?.maxZ ?? 0);
    assert.ok(gap <= propDimensions.clearanceStuds + 1e-9, `machines ${String(gap)} studs apart`);
  }
  assert.ok(
    room.doors.every((door) => door.side !== "east"),
    "the east wall has no door",
  );
  const doorStrip = southDoor.position.x;
  assert.ok(footprints.every((footprint) => footprint.minX > doorStrip + southDoor.width / 2));
  for (const pillar of arranged.filter((piece) => piece.kind === "pillar")) {
    for (const footprint of footprints) {
      assert.ok(
        footprintGap(footprint, footprintOf(pillar)) >= propDimensions.clearanceStuds,
        `a machine stands within ${String(propDimensions.clearanceStuds)} studs of a pillar`,
      );
    }
  }
});

await test("the concourse's departure board stands on the south wall beside the doorway, clear of its strip, arch and the pillars", async () => {
  const { spec, room, setPieces, arranged, southDoor, preset } = await placeBenchmarkConcourse();
  const board = setPieces.find((piece) => piece.kind === "departure-board");
  assert.ok(board !== undefined);
  assert.equal(board.yaw, 0, "faces north, into the hall");
  const footprint = footprintOf(board);
  const southInnerFace = room.z + room.depth / 2 - southDoor.wallThickness;
  assert.ok(Math.abs(southInnerFace - footprint.maxZ) < 0.01, "against the south wall");
  const archReach =
    southDoor.width / 2 + detailDimensions.archJambWidthStuds - detailDimensions.archLipStuds;
  const doorX = southDoor.position.x;
  const clearOfArch = footprint.maxX <= doorX - archReach || footprint.minX >= doorX + archReach;
  assert.ok(clearOfArch, "clear of the doorway's arch");
  const agent = { radius: preset.sizeRules.agentRadius, height: preset.sizeRules.agentHeight };
  const strip = doorwayClearanceBoxes(spec, agent).find(
    (box) => box.room === room.name && box.side === "south",
  );
  assert.ok(strip !== undefined);
  assert.ok(
    footprint.maxX <= strip.min.x || footprint.minX >= strip.max.x,
    "clear of the doorway strip",
  );
  assert.ok(Math.abs(doorX - (footprint.minX + footprint.maxX) / 2) < room.width / 2);
  for (const pillar of arranged.filter((piece) => piece.kind === "pillar")) {
    assert.ok(
      footprintGap(footprint, footprintOf(pillar)) >= propDimensions.clearanceStuds,
      `board within ${String(propDimensions.clearanceStuds)} studs of the pillar at x ${String(pillar.pivot.x)}`,
    );
  }
});

await test("a concourse pendant falls inside the eye shot's field of view, above the departure board", async () => {
  const { spec, room, eyeShot, setPieces, preset } = await placeBenchmarkConcourse();
  const pendants = placeLights(spec, preset.lightRoles, preset.lightFixtures).filter(
    (light) => light.zone === room.name && light.fixture !== undefined,
  );
  assert.ok(pendants.length > 0);
  const board = setPieces.find((piece) => piece.kind === "departure-board");
  assert.ok(board !== undefined);
  const boardTop = board.pivot.y + board.size.y / 2;
  for (const pendant of pendants) {
    const fixture = pendant.fixture;
    assert.ok(fixture !== undefined);
    assert.ok(pendant.position.y - fixture.size.y / 2 >= boardTop, "hangs above the board's top");
  }
  const [cameraX, cameraY, cameraZ] = eyeShot.cameraPosition;
  const forward = unit(subtract(eyeShot.lookAt, eyeShot.cameraPosition));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const halfVertical = Math.tan((config.studioFieldOfViewDegrees * Math.PI) / 360);
  const visible = pendants.filter((pendant) => {
    const offset = subtract(
      [pendant.position.x, pendant.position.y, pendant.position.z],
      [cameraX, cameraY, cameraZ],
    );
    const depth = dot(offset, forward);
    return (
      depth > 0 &&
      Math.abs(dot(offset, up)) <= depth * halfVertical &&
      Math.abs(dot(offset, right)) <= depth * halfVertical * eyeViewAspect
    );
  });
  assert.ok(visible.length >= 1, "no pendant in the eye view");
});

type Triple = [number, number, number];

function subtract(first: Triple, second: Triple): Triple {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function dot(first: Triple, second: Triple): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function cross(first: Triple, second: Triple): Triple {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function unit(vector: Triple): Triple {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

await test("the train station lays the concourse spawn pad flush, in the floor's color", async () => {
  const { preset, spec, room } = await placeBenchmarkConcourse();
  assert.equal(preset.flushSpawn, true);
  const { parts } = layoutMap(spec, preset.surfaces, { flushSpawn: preset.flushSpawn });
  const spawn = parts.find((part) => part.name === `${room.name}-spawn`);
  const floor = parts.find((part) => part.name === `${room.name}-floor`);
  assert.ok(spawn !== undefined && floor !== undefined);
  assert.equal(spawn.size.y, config.flushSpawnThicknessStuds);
  assert.equal(spawn.color, floor.color);
  assert.equal(spawn.material, floor.material);
});

await test("the ticket hall's ticket counter replaces its ticket-counter set piece and fits its span", async () => {
  const { preset, setPieces } = await placeBenchmarkSetPieces();
  const counter = preset.heroProps?.["ticket-counter"];
  assert.ok(counter !== undefined);
  assert.equal(counter.replaces, "ticket-counter");
  assert.deepEqual(preset.roomTypes?.["ticket-hall"]?.heroProps, ["ticket-counter"]);
  const setPiece = setPieces.find((piece) => piece.kind === "ticket-counter");
  assert.ok(setPiece !== undefined);
  assert.ok(
    counter.size.width <= setPiece.size.x,
    `counter ${String(counter.size.width)} studs wide`,
  );
  assert.ok(
    counter.size.height <= setPiece.size.y,
    `counter ${String(counter.size.height)} studs high`,
  );
});

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

await test("train-station has a Marble floor, CeramicTiles walls, Metal trim and no textures", async () => {
  const presets = await loadPresets();
  const preset = presets.get("train-station");
  assert.ok(preset !== undefined);
  assert.equal(preset.surfaces.floor.material, "Marble");
  assert.equal(preset.surfaces.wall.material, "CeramicTiles");
  assert.equal(preset.surfaces.trim.material, "Metal");
  for (const [role, surface] of Object.entries(preset.surfaces)) {
    assert.equal(surface.texture, undefined, `${role} texture`);
    assert.equal(surface.variant, undefined, `${role} variant`);
  }
});
