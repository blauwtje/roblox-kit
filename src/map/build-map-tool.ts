import { z } from "zod";
import { config } from "../config.ts";
import type { HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import type { ToolContext, ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { paletteIssueKinds } from "../style/palette-lint.ts";
import { lookIssueKinds } from "./look-lint.ts";
import { planMap } from "./build-plan.ts";
import { relationMapSpecSchema } from "./map-spec.ts";
import { fillMapSpec } from "./spec-fill.ts";
import { loadPresets } from "../style/load-preset.ts";
import { runBuildPlan } from "./run-build-plan.ts";

export { propsOf } from "./build-plan.ts";

const vectorSchema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const boundsSchema = z.strictObject({ min: vectorSchema, max: vectorSchema });

const relationMapSpecShape = relationMapSpecSchema.shape;
const presets = await loadPresets();

const fieldNotes = {
  mapId:
    "Handle of the map Model; building the same id again replaces it. Absent: the style preset name.",
  rooms:
    "The rooms, each with a size, doors and a center or a relation. Absent: one room per preset room type.",
  terrain: "Terrain fills (block, ball, wedge or heightmap) written to Terrain.",
  style:
    "{ preset, overrides }: the genre preset that furnishes, paints and lights the map. A style alone is enough.",
  seed: "Seeds every random choice, so the same seed gives the same map.",
  objectives: "Goals the map should support, checked by check_map.",
  performanceBudget: "Limits on parts, lights and the like that check_map reports against.",
  npcs: "Opt-in people: { density 0-1, seed, maxTotal }. Off unless set.",
  clutter: "Opt-in loose clutter. Off by default.",
  signage: "Opt-in signs. Off by default.",
  motion: "Opt-in moving set pieces. Off by default.",
  floorMaterial: "Default floor material for all rooms.",
  wallMaterial: "Default wall material for all rooms.",
  wallHeight: "Default wall height in studs.",
  wallThickness: "Default wall thickness in studs.",
  doorWidth: "Default door width in studs.",
  studioId: "Which Studio builds the map; optional while exactly one is connected.",
} as const;

const specShape = {
  ...relationMapSpecShape,
  mapId: z.string().min(1).optional(),
  rooms: relationMapSpecShape.rooms.optional(),
  studioId: z.string().min(1).optional(),
};
const describedShape = Object.fromEntries(
  Object.entries(specShape).map(([name, field]) => [
    name,
    field.describe(fieldNotes[name as keyof typeof fieldNotes]),
  ]),
) as typeof specShape;

const buildMapInput = z.strictObject({
  ...describedShape,
  useRecordedAssets: z
    .boolean()
    .default(false)
    .describe("Opt-in: use recorded asset ids (hero props, trim meshes, sprites). Off by default."),
});

const buildMapOutput = z.strictObject({
  mapId: z.string(),
  partCount: z.number().int(),
  /** The seven build phases in the order they ran, each with the number of parts it built. */
  phases: z.array(z.strictObject({ name: z.string(), partCount: z.number().int() })),
  bounds: boundsSchema,
  zones: z.array(
    z.strictObject({ name: z.string(), partCount: z.number().int(), bounds: boundsSchema }),
  ),
  /** One line per set piece skipped because its room has no space for it, per hero prop not built and why, per hero asset that failed to load and per ambient sprite with no recorded asset. */
  warnings: z.array(z.string()),
  /**
   * Look problems of the plan, found before Studio is touched; they warn and never fail a build. Only walkway
   * and doorway issues carry a `suggestedSpecPatch`, a JSON merge patch of this tool's input.
   */
  lookIssues: z.array(
    z.strictObject({
      kind: z.enum([...lookIssueKinds, ...paletteIssueKinds]),
      zone: z.string(),
      detail: z.string(),
      suggestedSpecPatch: z
        .strictObject({ rooms: z.array(z.record(z.string(), z.unknown())) })
        .optional(),
    }),
  ),
  /** Pixels of the plan's distinct material-map images (at the baked map size) and ambient sprites, each counted once; 0 with recorded assets off. */
  texturePixels: z.number().int(),
  fills: z.array(z.string()).optional(),
});

/** Builds the map phase by phase; `heroSources` says where recorded hero assets are looked up. */
async function buildMap(
  input: z.output<typeof buildMapInput>,
  context: ToolContext,
  heroSources: HeroPropSources,
) {
  const { spec, fills } = fillMapSpec(input, presets);
  const plan = await planMap(spec, heroSources);
  const { partCount, warnings } = await runBuildPlan(plan, context);
  return toolResult({
    mapId: plan.mapId,
    partCount,
    phases: plan.phaseSizes,
    bounds: plan.bounds,
    zones: plan.zones,
    warnings,
    lookIssues: plan.lookIssues,
    texturePixels: plan.texturePixels,
    ...(fills.length > 0 ? { fills } : {}),
  });
}

/** build_map with its recorded hero assets looked up through `heroSources`, so a test can fake the record. */
export function buildMapToolWith(heroSources: HeroPropSources): typeof buildMapTool {
  return { ...buildMapTool, handler: (input, context) => buildMap(input, context, heroSources) };
}

export const buildMapTool: ToolDefinition<typeof buildMapInput, typeof buildMapOutput> = {
  name: "build_map",
  title: "Build map",
  description:
    `Builds a map in the open place under Workspace.${config.mapsFolderName}. A style alone is enough: the rest is filled in and listed in "fills". Without a style, each room gets a floor, walls with door gaps and an optional SpawnLocation; terrain fills are optional. With a style, rooms also get ceilings (tagged ${config.ceilingTag}), trim, props, point lights and the preset's Lighting. ` +
    `A room gives a center (x, z) or a relation { to, direction, hallwayLength, hallwayWidth } that places it beside another room, joined by a hallway zone. Opt-in extras, off unless the user asks: npcs, clutter, signage, motion and useRecordedAssets (the author's own recorded assets; off builds from Luau generators and plain materials). ` +
    `The map is one Model named mapId, the handle later tools take. Building the same mapId again replaces the Model and its terrain. The build runs in seven phases and a failed phase may leave a partial Model. ` +
    `Returns { mapId, partCount, phases, bounds, zones, warnings, lookIssues, texturePixels, fills }: parts per phase, studs bounds of the map and each zone, skipped-item warnings, and plan-time lookIssues (warning only, some with a suggestedSpecPatch).`,
  inputSchema: buildMapInput,
  outputSchema: buildMapOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: (input, context) => buildMap(input, context, {}),
};
