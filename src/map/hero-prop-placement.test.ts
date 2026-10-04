import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recipeHash } from "../hero-props/recipe-hash.ts";
import { loadPresets } from "../style/load-preset.ts";
import type { Preset } from "../style/preset-schema.ts";
import { resolveStyle } from "../style/resolve-style.ts";
import { propsOf } from "./build-map-tool.ts";
import { readHeroAssets } from "../hero-props/hero-asset-store.ts";
import { heroRecipeHash, type HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import { heroPropsOf } from "./hero-prop-placement.ts";
import { relationMapSpecSchema } from "./map-spec.ts";
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
    recipe.parts.map((part) => [part.role, base.surfaces[part.role].color]),
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
      [...new Set(recipe.parts.map((part) => part.role))].map((role) => [
        role,
        { color: base.surfaces[role].color, material: base.surfaces[role].material },
      ]),
    ),
    fallback: {
      kind: "track-bed",
      pivot: trackBed.pivot,
      size: trackBed.size,
      seed: trackBed.seed,
      yaw: trackBed.yaw,
      attributes: {},
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
  assert.ok(sources.assetsFile !== undefined);
  const directory = fileURLToPath(new URL(".", sources.assetsFile));
  const folder = join(directory, "hero-props", `train-station-train-car-${hash}`);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "review.json"), JSON.stringify({ hash, passed: true }));
  const result = await heroPropsOf(spec, preset, placed.props, sources);
  assert.deepEqual(result.props, placed.props);
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
