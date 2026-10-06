import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { config } from "../config.ts";
import { recipeHash } from "../hero-props/recipe-hash.ts";
import { loadPresets } from "../style/load-preset.ts";
import { heroParts, type Preset } from "../style/preset-schema.ts";
import { resolveStyle } from "../style/resolve-style.ts";
import { propsOf } from "./build-map-tool.ts";
import { readHeroAssets } from "../hero-props/hero-asset-store.ts";
import { heroRecipeHash, type HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import { declaredTrimOf, heroPropsOf } from "./hero-prop-placement.ts";
import { layoutMap } from "./map-layout.ts";
import { buildRoomDetails } from "./room-details.ts";
import { relationMapSpecSchema } from "./map-spec.ts";
import { placeSetPieces } from "./set-piece-placement.ts";
import { doorwayClearanceBoxes } from "./size-rules.ts";
import { resolveRelations } from "./relation-solver.ts";

const presets = await loadPresets();
const base = presets.get("train-station");
assert.ok(base !== undefined);

/** The style with every room type's hero props cut to the train car, so other hero props the preset gains stay out of these tests. */
function trainCarOnly(style: Preset): Preset {
  if (style.roomTypes === undefined) return style;
  const roomTypes = Object.fromEntries(
    Object.entries(style.roomTypes).map(([name, roomType]) => [
      name,
      roomType.heroProps === undefined
        ? roomType
        : { ...roomType, heroProps: roomType.heroProps.filter((kind) => kind === "train-car") },
    ]),
  );
  return { ...style, roomTypes };
}

const preset = { name: "train-station", base, style: trainCarOnly(base) };
const benchmark = new URL("../../eval/benchmarks/train-station.json", import.meta.url);
const spec = resolveRelations(
  relationMapSpecSchema.parse(JSON.parse(await readFile(benchmark, "utf8"))),
);
const recipe = base.heroProps?.["train-car"];
assert.ok(recipe !== undefined);
const hash = await heroRecipeHash(base, "train-car");

/** A temporary hero-assets.json; `recorded` writes the train car's asset record. */
async function fakeSources(options: { recorded?: boolean }): Promise<HeroPropSources> {
  const directory = await mkdtemp(join(tmpdir(), "hero-placement-"));
  const assetsFile = pathToFileURL(join(directory, "hero-assets.json"));
  const assets = options.recorded ? { [hash]: { kind: "train-car", assetId: "123456" } } : {};
  await writeFile(assetsFile, JSON.stringify(assets));
  return { assetsFile };
}

async function writeIfAbsent(file: URL, text: string): Promise<boolean> {
  try {
    await writeFile(file, text, { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Runs `run` with a passed review and a GLB for the train car in the folder the old uploader read, Open Cloud
 * credentials in the environment and `fetch` counted, then puts all of it back. Returns the number of fetch calls.
 */
async function countFetchesWithReviewedTrainCar(run: () => Promise<void>): Promise<number> {
  const folder = new URL(
    `../../${config.heroPropsFolder}/train-station-train-car-${hash}/`,
    import.meta.url,
  );
  const created = await mkdir(folder, { recursive: true });
  const reviewFile = new URL("review.json", folder);
  const glbFile = new URL("model.glb", folder);
  const wroteReview = await writeIfAbsent(reviewFile, JSON.stringify({ hash: hash, passed: true }));
  const wroteGlb = await writeIfAbsent(glbFile, "glTF");
  const savedEnv = process.env;
  const withoutGroup = Object.entries(savedEnv).filter(
    ([name]) => name !== config.openCloudCreatorGroupIdEnv,
  );
  process.env = {
    ...Object.fromEntries(withoutGroup),
    [config.openCloudApiKeyEnv]: "test-key",
    [config.openCloudCreatorUserIdEnv]: "42",
  };
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return Promise.reject(new Error("no Open Cloud call is expected"));
  };
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
    process.env = savedEnv;
    // Only what this helper created is removed; a review already on disk is left alone.
    if (created !== undefined) await rm(created, { recursive: true, force: true });
    if (created === undefined && wroteReview) await rm(reviewFile, { force: true });
    if (created === undefined && wroteGlb) await rm(glbFile, { force: true });
  }
  return fetchCalls;
}

const platform = spec.rooms.find((room) => room.roomType === "platform");
assert.ok(platform !== undefined);
const placed = propsOf(spec, base);
const inPlatform = (pivot: { x: number; z: number }) =>
  Math.abs(pivot.x - platform.x) <= platform.width / 2 &&
  Math.abs(pivot.z - platform.z) <= platform.depth / 2;
const trackBed = placed.props.find(
  (prop) => prop.kind === "track-bed" && inPlatform(prop.pivot),
) as ((typeof placed.props)[number] & { yaw: number }) | undefined;
assert.ok(trackBed !== undefined, "the benchmark platform has a track bed");

await test("the recipe hash repeats generate-hero-prop's computation over the recipe, its role colors and the generator", async () => {
  const generator = await readFile(
    new URL("../hero-props/generate-hero-prop.py", import.meta.url),
    "utf8",
  );
  const roleColors = Object.fromEntries(
    heroParts(recipe.operations).map((part) => [
      part.shape.role,
      base.surfaces[part.shape.role].color,
    ]),
  );
  assert.equal(hash, recipeHash({ recipe, roleColors }, generator));
  assert.match(hash, /^[0-9a-f]{12}$/);
});

await test("a recorded asset takes the replaced set piece's slot, standing on its base, turned by its yaw", async () => {
  const sources = await fakeSources({ recorded: true });
  const result = await heroPropsOf(spec, preset, placed.props, sources);
  assert.deepEqual(result.warnings, []);
  assert.ok(!result.props.includes(trackBed), "the track bed is dropped");
  assert.equal(result.props.length, placed.props.length - 1);
  assert.equal(result.heroProps.length, 1);
  const [hero] = result.heroProps;
  const baseY = trackBed.pivot.y - trackBed.size.y / 2;
  assert.deepEqual(hero, {
    kind: "train-car",
    assetId: "123456",
    pivot: { x: trackBed.pivot.x, y: baseY + recipe.size.height / 2, z: trackBed.pivot.z },
    yaw: trackBed.yaw,
    size: { x: recipe.size.width, y: recipe.size.height, z: recipe.size.depth },
    surfaces: Object.fromEntries(
      [...new Set(heroParts(recipe.operations).map((part) => part.shape.role))].map((role) => [
        role,
        { color: base.surfaces[role].color, material: base.surfaces[role].material },
      ]),
    ),
    bevels: Object.fromEntries(
      [...new Set(heroParts(recipe.operations).map((part) => part.shape.role))].map((role) => [
        role,
        Math.min(
          ...heroParts(recipe.operations)
            .filter((part) => part.shape.role === role)
            .map((part) => part.shape.bevel ?? 0),
        ),
      ]),
    ),
    fallback: {
      kind: "track-bed",
      pivot: trackBed.pivot,
      size: trackBed.size,
      seed: trackBed.seed,
      yaw: trackBed.yaw,
      attributes: trackBed.attributes,
    },
  });
});

await test("the surfaces come from the resolved style while the hash stays the base preset's", async () => {
  const style = resolveStyle(presets, {
    preset: "train-station",
    overrides: { surfaces: { floor: { color: "#123456" } } },
  });
  const sources = await fakeSources({ recorded: true });
  const result = await heroPropsOf(
    spec,
    { ...preset, style: trainCarOnly(style) },
    placed.props,
    sources,
  );
  assert.equal(result.heroProps[0]?.surfaces["floor"]?.color, "#123456");
});

await test("without a recorded asset the set piece stays and the warning says to upload from a clone", async () => {
  const sources = await fakeSources({});
  const result = await heroPropsOf(spec, preset, placed.props, sources);
  assert.deepEqual(result.props, placed.props);
  assert.deepEqual(result.heroProps, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /"platform" keeps its track-bed/);
  assert.match(result.warnings[0] ?? "", new RegExp(`train-car \\(recipe ${hash}\\)`));
  assert.match(
    result.warnings[0] ?? "",
    /generate and upload it from a clone of the roblox-kit repo/,
  );
  assert.doesNotMatch(result.warnings[0] ?? "", /API_KEY|key file|npm run/i);
});

await test("a passed review alone uploads nothing and records nothing", async () => {
  const sources = await fakeSources({});
  let result: Awaited<ReturnType<typeof heroPropsOf>> | undefined;
  const fetchCalls = await countFetchesWithReviewedTrainCar(async () => {
    result = await heroPropsOf(spec, preset, placed.props, sources);
  });
  assert.equal(fetchCalls, 0, "no Open Cloud call is made");
  assert.deepEqual(result?.props, placed.props);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(await readHeroAssets(sources.assetsFile), {});
});

await test("a room with no set piece to replace gets a warning and no hero prop", async () => {
  const sources = await fakeSources({ recorded: true });
  const withoutBed = placed.props.filter((prop) => prop !== trackBed);
  const result = await heroPropsOf(spec, preset, withoutBed, sources);
  assert.deepEqual(result.heroProps, []);
  assert.deepEqual(result.props, withoutBed);
  assert.match(result.warnings[0] ?? "", /no track-bed set piece for hero prop train-car/);
});

await test("a hero prop too big for its room keeps the set piece and warns", async () => {
  const sources = await fakeSources({ recorded: true });
  // A 20-stud platform holds a track bed, but not the 40-stud train car standing in its slot.
  const small = resolveRelations(
    relationMapSpecSchema.parse({
      mapId: "small",
      seed: 1,
      wallHeight: 16,
      doorWidth: 10,
      rooms: [
        { name: "hall", x: 0, z: 0, width: 20, depth: 20, roomType: "concourse" },
        {
          name: "yard",
          roomType: "platform",
          width: 20,
          depth: 20,
          relation: { to: "hall", direction: "east", hallwayLength: 14, hallwayWidth: 14 },
        },
      ],
    }),
  );
  const smallProps = propsOf(small, base).props;
  assert.ok(smallProps.some((prop) => prop.kind === "track-bed"));
  const result = await heroPropsOf(small, preset, smallProps, sources);
  assert.deepEqual(result.heroProps, []);
  assert.deepEqual(result.props, smallProps);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /"yard" keeps its track-bed set piece/);
  assert.match(result.warnings[0] ?? "", /does not fit/);
});

await test("a style whose room types name no hero props reads nothing and changes nothing", async () => {
  const cozy = presets.get("cozy-town");
  assert.ok(cozy !== undefined);
  const missing = pathToFileURL(join(tmpdir(), "no-such-folder", "hero-assets.json"));
  const plain = resolveRelations(
    relationMapSpecSchema.parse({
      mapId: "plain",
      rooms: [{ name: "a", x: 0, z: 0, width: 20, depth: 20 }],
    }),
  );
  const result = await heroPropsOf(plain, { name: "cozy-town", base: cozy, style: cozy }, [], {
    assetsFile: missing,
  });
  assert.deepEqual(result, { props: [], heroProps: [], warnings: [] });
});

/** The train station with no room types, so only the prop-kind meshes can replace a prop. */
const plainPreset = { name: "train-station", base, style: { ...base, roomTypes: undefined } };
const turnedBench = {
  kind: "bench" as const,
  pivot: { x: 5, y: 1.5, z: 7 },
  size: { x: 2.5, y: 3, z: 6 },
  seed: 4,
};
const lamp = {
  kind: "lamp" as const,
  pivot: { x: 9, y: 4.5, z: 1 },
  size: { x: 1.5, y: 9, z: 1.5 },
  seed: 5,
};

await test("a prop kind with a recorded mesh becomes that mesh, stretched to the prop's own box", async () => {
  const benchHash = await heroRecipeHash(base, "prop-bench");
  const directory = await mkdtemp(join(tmpdir(), "prop-mesh-"));
  const assetsFile = pathToFileURL(join(directory, "hero-assets.json"));
  await writeFile(
    assetsFile,
    JSON.stringify({ [benchHash]: { kind: "prop-bench", assetId: "777" } }),
  );
  try {
    const result = await heroPropsOf(spec, plainPreset, [turnedBench, lamp], { assetsFile });
    assert.deepEqual(result.props, [lamp]);
    assert.deepEqual(result.warnings, []);
    const [mesh] = result.heroProps;
    assert.equal(result.heroProps.length, 1);
    assert.ok(mesh !== undefined);
    assert.equal(mesh.kind, "bench");
    assert.equal(mesh.assetId, "777");
    assert.equal(mesh.fit, "stretch");
    assert.deepEqual(mesh.pivot, turnedBench.pivot);
    // The bench recipe is wide along x; the prop's long side runs along z, so the mesh turns and swaps x and z.
    assert.equal(mesh.yaw, 90);
    assert.deepEqual(mesh.size, { x: 6, y: 3, z: 2.5 });
    assert.deepEqual(mesh.fallback, turnedBench);
    assert.ok(Object.keys(mesh.surfaces).length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("a prop kind with no recorded mesh keeps its Luau model, with no warning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prop-mesh-"));
  const assetsFile = pathToFileURL(join(directory, "hero-assets.json"));
  await writeFile(assetsFile, "{}");
  try {
    const result = await heroPropsOf(spec, plainPreset, [turnedBench, lamp], { assetsFile });
    assert.deepEqual(result, { props: [turnedBench, lamp], heroProps: [], warnings: [] });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("the departure board's hero prop stands where the board beside the south door stood, off the wall by its own depth", async () => {
  const concourse = spec.rooms.find((room) => room.roomType === "concourse");
  assert.ok(concourse !== undefined);
  const board = base.heroProps?.["departure-board"];
  assert.ok(board !== undefined);
  const roomTypes = Object.fromEntries(
    Object.entries(base.roomTypes ?? {}).map(([name, roomType]) => [
      name,
      { ...roomType, heroProps: roomType.heroProps?.filter((kind) => kind === "departure-board") },
    ]),
  );
  const agent = { radius: base.sizeRules.agentRadius, height: base.sizeRules.agentHeight };
  const { pieces, warnings } = placeSetPieces(
    spec,
    roomTypes,
    base.palette.accent,
    1,
    doorwayClearanceBoxes(spec, agent),
    base.propRules,
    base.heroProps,
  );
  const piece = pieces.find((candidate) => candidate.kind === "departure-board");
  assert.ok(piece !== undefined);
  assert.deepEqual(warnings, []);
  const boardHash = await heroRecipeHash(base, "departure-board");
  const directory = await mkdtemp(join(tmpdir(), "hero-board-"));
  const assetsFile = pathToFileURL(join(directory, "hero-assets.json"));
  await writeFile(
    assetsFile,
    JSON.stringify({ [boardHash]: { kind: "departure-board", assetId: "555" } }),
  );
  try {
    const result = await heroPropsOf(
      spec,
      { name: "train-station", base, style: { ...base, roomTypes } },
      pieces,
      { assetsFile },
    );
    const hero = result.heroProps.find((candidate) => candidate.kind === "departure-board");
    assert.ok(hero !== undefined, `no hero board; warnings ${JSON.stringify(result.warnings)}`);
    assert.equal(hero.pivot.x, piece.pivot.x);
    assert.equal(hero.pivot.z, piece.pivot.z);
    assert.equal(hero.yaw, piece.yaw);
    const southInnerFace = concourse.z + concourse.depth / 2 - 1;
    assert.ok(
      hero.pivot.z + board.size.depth / 2 <= southInnerFace + 1e-9,
      "the hero board stays inside the south wall",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const declaredBase: Preset = base;

/** A temporary hero-assets.json recording `kinds` of the preset's declared meshes, the nth as asset "<n+1>00". */
async function declaredSources(kinds: string[]): Promise<HeroPropSources> {
  const directory = await mkdtemp(join(tmpdir(), "declared-mesh-"));
  const assetsFile = pathToFileURL(join(directory, "hero-assets.json"));
  const assets: Record<string, { kind: string; assetId: string }> = {};
  for (const [index, kind] of kinds.entries()) {
    assets[await heroRecipeHash(declaredBase, kind)] = { kind, assetId: `${String(index + 1)}00` };
  }
  await writeFile(assetsFile, JSON.stringify(assets));
  return { assetsFile };
}

const ticketMachine = {
  kind: "ticket-machine" as const,
  pivot: { x: 4, y: 3, z: 8 },
  size: { x: 3, y: 6, z: 2 },
  yaw: 90,
  seed: 6,
};
const clock = {
  kind: "clock" as const,
  pivot: { x: 2, y: 12, z: 1 },
  size: { x: 3, y: 3, z: 0.5 },
  seed: 7,
};
const concourseSign = {
  kind: "sign" as const,
  pivot: { x: 1, y: 10, z: 1 },
  size: { x: 6, y: 2, z: 0.4 },
  seed: 8,
  attributes: { Label: "CONCOURSE" },
};
const platformSign = { ...concourseSign, attributes: { Label: "PLATFORM 1" } };

await test("a declared mesh replaces its piece at the piece's anchor, unscaled, with the target's extra turn", async () => {
  const sources = await declaredSources(["ticket-machine", "clock", "sign"]);
  const props = [ticketMachine, clock, concourseSign, platformSign, lamp];
  const result = await heroPropsOf(spec, plainPreset, props, sources);
  assert.deepEqual(result.props, [platformSign, lamp]);
  assert.deepEqual(result.warnings, []);
  const [machine, face, sign] = result.heroProps;
  assert.equal(result.heroProps.length, 3);
  assert.ok(machine !== undefined && face !== undefined && sign !== undefined);
  assert.equal(machine.assetId, "100");
  assert.equal(machine.fit, "none");
  assert.equal(machine.anchor, "bottom");
  assert.deepEqual(machine.pivot, { x: 4, y: 0, z: 8 });
  assert.equal(machine.yaw, 270);
  assert.equal(machine.part, undefined);
  assert.equal(machine.fallback, ticketMachine);
  assert.equal(face.anchor, "center");
  assert.deepEqual(face.pivot, clock.pivot);
  assert.equal(face.yaw, 0);
  assert.equal(sign.fallback, concourseSign);
});

await test("a declared mesh wins over the prop kind's recipe, and a mesh with no recorded asset leaves the piece", async () => {
  const benchHash = await heroRecipeHash(base, "prop-bench");
  const directory = await mkdtemp(join(tmpdir(), "declared-wins-"));
  const assetsFile = pathToFileURL(join(directory, "hero-assets.json"));
  await writeFile(
    assetsFile,
    JSON.stringify({
      [await heroRecipeHash(base, "bench")]: { kind: "bench", assetId: "100" },
      [benchHash]: { kind: "prop-bench", assetId: "777" },
    }),
  );
  const both = await heroPropsOf(spec, plainPreset, [turnedBench], { assetsFile });
  assert.deepEqual(
    both.heroProps.map(({ assetId, fit }) => ({ assetId, fit })),
    [{ assetId: "100", fit: "none" }],
  );
  assert.deepEqual(both.props, []);
  const none = await declaredSources([]);
  const kept = await heroPropsOf(spec, plainPreset, [turnedBench, clock], none);
  assert.deepEqual(kept, { props: [turnedBench, clock], heroProps: [], warnings: [] });
});

await test("the concourse room type no longer lists the departure board as a hero prop", () => {
  assert.deepEqual(base.roomTypes?.concourse?.heroProps ?? [], []);
  assert.ok(base.heroProps?.["departure-board"] !== undefined);
  assert.ok(base.meshes?.["departure-board"] !== undefined);
});

await test("a declared arch-trim mesh replaces each doorway arch and each crown and baseboard run", async () => {
  const details = buildRoomDetails(spec, layoutMap(spec, base.surfaces).parts, base.surfaces);
  const arches = details.filter((detail) => detail.kind === "arch");
  const runs = details.filter((detail) => /-(crown|baseboard)-/.test(detail.name));
  assert.ok(arches.length > 0 && runs.length > 0);

  const result = await declaredTrimOf(details, { base }, await declaredSources(["arch-trim"]));
  const archRecords = result.declaredTrim.filter((record) => record.kind === "arch");
  assert.equal(archRecords.length * 3, arches.length);
  assert.equal(result.declaredTrim.length, archRecords.length + runs.length);
  assert.equal(result.details.length, details.length - arches.length - runs.length);
  for (const record of archRecords) {
    assert.equal(record.part, "arch");
    assert.equal(record.fit, "stretch");
    assert.equal(record.fallbackParts.length, 3);
    const lintel = record.fallbackParts.find((part) => part.name.endsWith("-lintel"));
    assert.ok(lintel !== undefined);
    assert.ok(
      Math.abs(record.pivot.x - lintel.position.x) < 1e-9 ||
        Math.abs(record.pivot.z - lintel.position.z) < 1e-9,
    );
    assert.ok(Math.abs(record.pivot.y - (record.fallbackParts[0]?.position.y ?? NaN)) < 1e-9);
    assert.equal(record.yaw, lintel.size.z > lintel.size.x ? 90 : 0);
    // The record's box is the frame's outer bounds: the jambs' span along the wall, their height, the arch's depth.
    const [jambA, jambB] = record.fallbackParts.filter((part) => part !== lintel);
    assert.ok(jambA !== undefined && jambB !== undefined);
    const alongZ = record.yaw === 90;
    const axis = alongZ ? "z" : "x";
    const span = Math.abs(jambA.position[axis] - jambB.position[axis]) + jambA.size[axis];
    assert.ok(Math.abs(record.size.x - span) < 1e-9);
    assert.ok(Math.abs(record.size.y - jambA.size.y) < 1e-9);
    assert.ok(Math.abs(record.size.z - lintel.size[alongZ ? "x" : "z"]) < 1e-9);
  }
  for (const record of result.declaredTrim.filter((entry) => entry.kind !== "arch")) {
    const [run] = record.fallbackParts;
    assert.ok(run !== undefined && run.profile !== undefined);
    assert.ok(run.name.includes(`-${record.kind}-`));
    assert.equal(record.part, record.kind);
    assert.equal(record.fit, "stretch");
    assert.deepEqual(record.pivot, run.position);
    assert.deepEqual(record.size, { x: run.profile.size.z, y: 0.5, z: 0.3 });
    // The profile faces local -Z; turned by the yaw it must point from the wall into the room.
    const turn = (record.yaw * Math.PI) / 180;
    const face = { x: -Math.sin(turn), z: -Math.cos(turn) };
    const room = spec.rooms.find((candidate) => candidate.name === run.room);
    assert.ok(room !== undefined);
    assert.ok((room.x - run.position.x) * face.x + (room.z - run.position.z) * face.z > 0);
  }

  const none = await declaredTrimOf(details, { base }, await declaredSources([]));
  assert.deepEqual(none, { details, declaredTrim: [] });
});
