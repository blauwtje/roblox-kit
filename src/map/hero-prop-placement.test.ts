import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { config } from "../config.ts";
import { recipeHash } from "../hero-props/recipe-hash.ts";
import { loadPresets } from "../style/load-preset.ts";
import type { Preset } from "../style/preset-schema.ts";
import { resolveStyle } from "../style/resolve-style.ts";
import { propsOf } from "./build-map-tool.ts";
import { readHeroAssets } from "../hero-props/hero-asset-store.ts";
import { heroRecipeHash, type HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import { lookUpOpenCloudCredentials } from "../hero-props/open-cloud-credentials.ts";
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

/** Open Cloud answers for a fake fetch: each call gets the next one, and every call is counted; no network. */
function fakeFetch(responses: Response[]): { fetchFn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchFn: typeof fetch = (input) => {
    calls.push(new Request(input).url);
    const next = responses.shift();
    return next === undefined
      ? Promise.reject(new Error("unexpected fetch"))
      : Promise.resolve(next);
  };
  return { fetchFn, calls };
}

const testCredentials = { apiKey: "test-key", creator: { groupId: "718128661" } };

/**
 * A temporary hero-assets.json and hero-props folder; `recorded` writes the train car's asset record. With
 * `hasCredentials` the lookup finds test credentials, else it is the real lookup over an empty environment
 * and a project root with no key files. `fetchFn` answers the Open Cloud calls.
 */
async function fakeSources(options: {
  recorded?: boolean;
  review?: { hash: string; passed: boolean; glb?: boolean };
  hasCredentials?: boolean;
  fetchFn?: typeof fetch;
}): Promise<HeroPropSources> {
  const directory = await mkdtemp(join(tmpdir(), "hero-placement-"));
  const assetsFile = pathToFileURL(join(directory, "hero-assets.json"));
  const assets = options.recorded ? { [hash]: { kind: "train-car", assetId: "123456" } } : {};
  await writeFile(assetsFile, JSON.stringify(assets));
  const heroPropsDirectory = pathToFileURL(join(directory, "hero-props/"));
  if (options.review !== undefined) {
    const folder = join(directory, "hero-props", `train-station-train-car-${hash}`);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "review.json"), JSON.stringify(options.review));
    await writeFile(join(folder, "model.glb"), new Uint8Array([0x67, 0x6c, 0x54, 0x46]));
  }
  const root = pathToFileURL(`${directory}/`);
  return {
    assetsFile,
    heroPropsDirectory,
    credentials: options.hasCredentials
      ? () => Promise.resolve({ credentials: testCredentials })
      : () => lookUpOpenCloudCredentials({}, root),
    transport: { fetchFn: options.fetchFn ?? fakeFetch([]).fetchFn, pollIntervalMs: 0 },
  };
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

await test("without a passed review the set piece stays and the warning says so", async () => {
  for (const review of [undefined, { hash, passed: false }, { hash: "other", passed: true }]) {
    const sources = await fakeSources({ review, hasCredentials: true });
    const result = await heroPropsOf(spec, preset, placed.props, sources);
    assert.deepEqual(result.props, placed.props);
    assert.deepEqual(result.heroProps, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0] ?? "", /"platform" keeps its track-bed/);
    assert.match(result.warnings[0] ?? "", new RegExp(`train-car \\(recipe ${hash}\\)`));
    assert.match(result.warnings[0] ?? "", /no passed review/);
  }
});

await test("a passed review without an API key keeps the set piece and names the key", async () => {
  const sources = await fakeSources({ review: { hash, passed: true } });
  const result = await heroPropsOf(spec, preset, placed.props, sources);
  assert.deepEqual(result.props, placed.props);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", new RegExp(`${config.openCloudApiKeyEnv} is not set`));
  assert.match(result.warnings[0] ?? "", new RegExp(config.openCloudKeyFile));
  assert.doesNotMatch(result.warnings[0] ?? "", /npm run hero-props/);
});

await test("a passed review with credentials uploads the GLB once, records it and reuses the id afterwards", async () => {
  const finished = {
    path: "operations/op1",
    operationId: "op1",
    done: true,
    response: { assetId: "9001" },
  };
  const { fetchFn, calls } = fakeFetch([Response.json(finished)]);
  const sources = await fakeSources({
    review: { hash, passed: true },
    hasCredentials: true,
    fetchFn,
  });
  const first = await heroPropsOf(spec, preset, placed.props, sources);
  assert.deepEqual(first.warnings, []);
  assert.equal(first.heroProps[0]?.assetId, "9001");
  assert.ok(!first.props.includes(trackBed), "the track bed is replaced");
  assert.ok(sources.assetsFile !== undefined);
  assert.deepEqual(await readHeroAssets(sources.assetsFile), {
    [hash]: { kind: "train-car", assetId: "9001" },
  });
  const second = await heroPropsOf(spec, preset, placed.props, sources);
  assert.equal(second.heroProps[0]?.assetId, "9001");
  assert.equal(calls.length, 1, "the recorded id is reused without a second upload");
});

await test("a failed upload keeps the set piece and says the upload failed", async () => {
  const { fetchFn } = fakeFetch([Response.json({ message: "forbidden" }, { status: 403 })]);
  const sources = await fakeSources({
    review: { hash, passed: true },
    hasCredentials: true,
    fetchFn,
  });
  const result = await heroPropsOf(spec, preset, placed.props, sources);
  assert.deepEqual(result.props, placed.props);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /the upload failed.*403/);
  assert.doesNotMatch(result.warnings[0] ?? "", /test-key/);
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
    heroPropsDirectory: missing,
    credentials: () => Promise.reject(new Error("no credentials are looked up")),
  });
  assert.deepEqual(result, { props: [], heroProps: [], warnings: [] });
});
