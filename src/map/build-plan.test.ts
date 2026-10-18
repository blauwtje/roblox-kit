import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { heroRecipeHash, type HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import { loadPresets } from "../style/load-preset.ts";
import { planMap, propsOf } from "./build-plan.ts";
import { mapSpecSchema, relationMapSpecSchema } from "./map-spec.ts";

const rooms = [
  { name: "start", x: 0, z: 0, width: 40, depth: 40, spawn: true, doors: [{ side: "east" }] },
  { name: "hall", x: 40, z: 0, width: 40, depth: 40, doors: [{ side: "west" }] },
];

function inputOf(extra: object = {}, useRecordedAssets = false) {
  return {
    ...relationMapSpecSchema.parse({ mapId: "plan-map", rooms, ...extra }),
    useRecordedAssets,
  };
}

const presets = await loadPresets();
const stationPreset = presets.get("train-station");
assert.ok(stationPreset !== undefined);
const trainStation = stationPreset;

const benchmarkSpec = JSON.parse(
  await readFile(new URL("../../eval/benchmarks/train-station.json", import.meta.url), "utf8"),
) as object;

function assetIdOf(kind: string): string {
  return String(900000 + kind.length);
}

async function recordingSources(kinds: string[]): Promise<HeroPropSources> {
  const directory = await mkdtemp(join(tmpdir(), "build-plan-heroes-"));
  const assetsFile = pathToFileURL(join(directory, "hero-assets.json"));
  const assets: Record<string, { kind: string; assetId: string }> = {};
  for (const kind of kinds) {
    assets[await heroRecipeHash(trainStation, kind)] = { kind, assetId: assetIdOf(kind) };
  }
  await writeFile(assetsFile, JSON.stringify(assets));
  return { assetsFile };
}

type Placed = { kind: string };

function propsOfPlan(plan: Awaited<ReturnType<typeof planMap>>) {
  return plan.phases.find((phase) => phase.name === "props")?.parts as Placed[];
}

await test("a plan names the seven phases in order and their part counts without touching Studio", async () => {
  const plan = await planMap(inputOf(), {});
  assert.deepEqual(
    plan.phases.map((phase) => phase.name),
    [
      "shell",
      "floors and ceilings",
      "openings",
      "surfaces",
      "props",
      "lighting",
      "ambient effects",
    ],
  );
  assert.deepEqual(
    plan.phaseSizes,
    plan.phases.map((phase) => ({ name: phase.name, partCount: phase.parts.length })),
  );
  assert.deepEqual(
    plan.zones.map((zone) => zone.name),
    ["start", "hall"],
  );
  assert.equal(plan.recorded, false);
  assert.equal(plan.texturePixels, 0);
});

await test("a styled plan with recorded assets off carries no hero, trim or pendant meshes and flat variants", async () => {
  const plan = await planMap(inputOf({ style: { preset: "train-station" } }), {});
  assert.equal(plan.recorded, false);
  assert.deepEqual(plan.build.heroProps, []);
  assert.deepEqual(plan.build.trimMeshes, []);
  assert.deepEqual(plan.build.pendantMeshes, []);
  assert.ok(plan.lighting !== undefined);
  for (const variant of Object.values(plan.build.variants)) {
    assert.equal(variant.maps, undefined);
  }
  assert.ok(propsOfPlan(plan).length);
});

await test("a plan rejects a room type the style does not declare before anything else", async () => {
  await assert.rejects(
    planMap(inputOf({ rooms: [{ ...rooms[0], roomType: "nowhere" }] }), {}),
    /Room "start" has room type "nowhere"/,
  );
});

await test("a styled plan has props with one generator per kind, and an unstyled plan has none", async () => {
  const styled = await planMap(inputOf({ seed: 3, style: { preset: "cozy-town" } }), {});
  const props = propsOfPlan(styled);
  assert.ok(props.length > 0);
  assert.deepEqual(
    Object.keys(styled.build.generators).sort(),
    [...new Set(props.map((prop) => prop.kind))].sort(),
  );
  const plain = await planMap(inputOf(), {});
  assert.deepEqual(propsOfPlan(plain), []);
  assert.deepEqual(plain.build.generators, {});
});

await test("propsOf furnishes a typed room with its arrangements after its set pieces and merges warnings", () => {
  const preset = presets.get("cozy-town");
  assert.ok(preset !== undefined);
  const style = {
    ...preset,
    propRules: {
      ...preset.propRules,
      "track-bed": { freeRotation: false, placement: "track" as const },
    },
    roomTypes: {
      platform: {
        setPieces: ["track-bed"],
        signLabel: "PLATFORM 1",
        arrangements: [
          { shape: "along-length" as const, piece: "lamp", spacing: 12, inset: 2 },
          { shape: "grid" as const, piece: "pillar", spacing: 5000 },
        ],
      },
    },
  };
  const spec = mapSpecSchema.parse({
    mapId: "plan-map",
    rooms: rooms.map((room, index) =>
      index === 0 ? { ...room, roomType: "platform", width: 60, depth: 20 } : room,
    ),
  });
  const { props, warnings } = propsOf(spec, style);
  const kinds = props.map((prop) => prop.kind);
  assert.ok(kinds.includes("track-bed"));
  const afterSetPieces = kinds.slice(kinds.indexOf("track-bed") + 1);
  assert.ok(afterSetPieces.filter((kind) => kind === "lamp").length > 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /pillar/);
});

await test("propsOf gives every prop the preset's slot attributes, a surface role overriding frame and exempt keeping it", () => {
  const preset = presets.get("cozy-town");
  assert.ok(preset !== undefined);
  const lampRule = preset.propRules["lamp"];
  const benchRule = preset.propRules["bench"];
  assert.ok(lampRule !== undefined && benchRule !== undefined);
  const style = {
    ...preset,
    propKit: ["lamp", "bench"],
    propRules: {
      ...preset.propRules,
      lamp: { ...lampRule, surface: "accent" as const },
      bench: { ...benchRule, surface: "exempt" as const },
    },
  };
  const { props } = propsOf(mapSpecSchema.parse({ mapId: "plan-map", rooms }), style);
  const lamps = props.filter((prop) => prop.kind === "lamp");
  const benches = props.filter((prop) => prop.kind === "bench");
  assert.ok(lamps.length > 0 && benches.length > 0);
  const slotAttributes = Object.fromEntries(
    Object.entries(style.propSlots).flatMap(([slot, look]) => {
      const name = slot.charAt(0).toUpperCase() + slot.slice(1);
      return [
        [`${name}Color`, look.color],
        [`${name}Material`, look.material],
      ];
    }),
  );
  for (const lamp of lamps) {
    assert.deepEqual(lamp.attributes, {
      ...slotAttributes,
      FrameColor: style.surfaces.accent.color,
      FrameMaterial: style.surfaces.accent.material,
    });
  }
  for (const bench of benches) {
    assert.deepEqual(bench.attributes, slotAttributes);
  }
});

await test("a styled plan puts its lights under each room's floor, with one unshadowed hero light per zone and fixtures only on zone markers", async () => {
  const plan = await planMap(inputOf({ style: { preset: "train-station" } }), {});
  const lights = plan.phases.find((phase) => phase.name === "lighting")?.parts as {
    zone: string;
    part: string;
    role: string;
    shadows: boolean;
    fixture?: { pendant: boolean };
  }[];
  for (const zone of ["start", "hall"]) {
    const zoneLights = lights.filter((light) => light.zone === zone);
    assert.ok(zoneLights.every((light) => light.part === `${zone}-floor`));
    assert.deepEqual(
      zoneLights.filter((light) => light.role === "hero").map((light) => light.shadows),
      [false],
    );
    const fixtureLights = zoneLights.filter((light) => light.fixture !== undefined);
    assert.ok(fixtureLights.length > 0);
    assert.ok(fixtureLights.every((light) => light.role === "zoneMarker" && !light.shadows));
  }
  const plain = await planMap(inputOf(), {});
  assert.deepEqual(plain.phases.find((phase) => phase.name === "lighting")?.parts, []);
});

const counter = { kind: "ticket-counter", setPiece: "ticket-counter" };
const car = { kind: "train-car", setPiece: "track-bed" };

const heroCases = [
  {
    name: "a recorded ticket-counter takes the set piece's slot",
    ...counter,
    recorded: true,
    kept: false,
  },
  {
    name: "an unrecorded ticket-counter keeps its set piece",
    ...counter,
    recorded: false,
    kept: true,
  },
  { name: "a recorded train-car stands on the track bed", ...car, recorded: true, kept: true },
  {
    name: "an unrecorded train-car leaves the track bed bare",
    ...car,
    recorded: false,
    kept: true,
  },
];

for (const heroCase of heroCases) {
  await test(heroCase.name, async () => {
    const sources = await recordingSources(heroCase.recorded ? [heroCase.kind] : []);
    const plan = await planMap(
      { ...relationMapSpecSchema.parse(benchmarkSpec), useRecordedAssets: true },
      sources,
    );
    const heroes = plan.build.heroProps.filter((hero) => hero.kind === heroCase.kind);
    assert.equal(heroes.length, heroCase.recorded ? 1 : 0);
    const kept = propsOfPlan(plan).some((prop) => prop.kind === heroCase.setPiece);
    assert.equal(kept, heroCase.kept);
    if (heroCase.recorded) {
      assert.equal(heroes[0]?.assetId, assetIdOf(heroCase.kind));
      assert.equal(heroes[0].fallback !== undefined, !heroCase.kept);
    }
    assert.deepEqual(
      plan.warnings.filter((warning) => warning.includes(heroCase.kind)),
      [],
    );
  });
}

const stationInput = (extra: object = {}) =>
  inputOf({ ...benchmarkSpec, mapId: "switch-map", ...extra });

await test("switch: with every switch off a station plan has no npcs, clutter, motion or signage text", async () => {
  const plan = await planMap(stationInput(), {});
  assert.equal("npcs" in plan, false);
  const props = propsOfPlan(plan) as { attributes?: Record<string, string> }[];
  assert.equal(
    props.some((prop) =>
      Object.keys(prop.attributes ?? {}).some((name) => name.startsWith("Motion")),
    ),
    false,
  );
  assert.equal(
    props.some((prop) => "Rows" in (prop.attributes ?? {})),
    false,
  );
  assert.ok(plan.build.idle !== undefined);
});

await test("switch: clutter and motion add props and attributes only when on", async () => {
  const off = await planMap(stationInput(), {});
  const on = await planMap(stationInput({ clutter: true, motion: true }), {});
  assert.ok(propsOfPlan(on).length > propsOfPlan(off).length);
  const attributes = (propsOfPlan(on) as { attributes?: Record<string, string> }[]).flatMap(
    (prop) => prop.attributes?.["MotionKind"] ?? [],
  );
  assert.ok(attributes.length > 0);
});

await test("npc: a plan with npcs carries a roster and route graph, and one without carries none", async () => {
  const plan = await planMap(stationInput({ npcs: { density: 1 } }), {});
  assert.ok(plan.npcs !== undefined);
  assert.ok(plan.npcs.roster.length > 0);
  assert.ok(plan.npcs.graph.nodes.length > 0);
});
