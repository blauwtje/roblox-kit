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

const presets = await loadPresets();

const buildMapInput = z.strictObject({
  ...relationMapSpecSchema.shape,
  mapId: z.string().min(1).optional(),
  rooms: relationMapSpecSchema.shape.rooms.optional(),
  /** Which Studio builds the map; optional while exactly one is connected. */
  studioId: z.string().min(1).optional(),
  /**
   * Uses the recorded asset ids (hero props, trim meshes, ambient sprites and the baked maps of material
   * variants) that belong to the author's own places. Off by default: those ids do not load for other
   * users, so the map is built from Luau generators and plain materials, with no missing-asset warnings.
   */
  useRecordedAssets: z.boolean().default(false),
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
    `Builds a map from a data spec in the open place: per room an anchored floor, walls with door gaps and an optional SpawnLocation, plus terrain fills. With a style each room also gets a ceiling (tagged ${config.ceilingTag}, not colliding), baseboard, crown, stripe, pillar and arch details in the preset's trim and accent colors (none collide) and props from the preset's kit, each a ProceduralModel that shares one generator ModuleScript per kind in the map Model and is generated before the build returns; without a style none of these are built. A styled room marked exterior (optionally with facadeFloors storeys) also gets a facade on the outer face of its walls: an accent band between storeys, a framed window per bay and storey and a trim cornice, none colliding. A room gives its center (x, z) or a relation { to, direction, hallwayLength, hallwayWidth } that sets it beside another room on the 5-stud grid, joined by a hallway room named "<to>-<room>-hallway" that is one more zone. An optional style { preset, overrides } names a genre preset, is checked before Studio is asked, paints parts in its palette colors and materials, hangs point lights from its light roles under each room's floor (each light within ${String(config.lightCeilingDropStuds)} stud of a ceiling also gets a ${String(config.lightFixtureSizeStuds)}-stud Neon fixture part against the ceiling, tagged ${config.ceilingTag} so it hides with the ceilings), applies its lighting recipe to Lighting (the previous values are stored on the map Model for restore) and gives a role that names a MaterialVariant one flat MaterialVariant in MaterialService, named after the map and role and reused on rebuild; an optional seed defaults to ${String(config.defaultSeed)}. ` +
    `Recorded assets are off by default: with useRecordedAssets false (the default) hero props, trim meshes, ambient sprite textures and the baked maps of MaterialVariants are all skipped, the map is built from Luau generators and plain materials and no missing-asset or missing-sprite warning is returned. Set useRecordedAssets true only for the author's own places, where those ids load; the rest of this paragraph and the next two describe that mode. ` +
    `A room type that lists hero props gets each one's uploaded asset, found by recipe hash in hero-assets.json, in place of the set piece it replaces: loaded with InsertService, scaled to its recipe size, its MeshParts colored from the surface role each is named after, anchored and not colliding. A declared mesh whose target is onto:prop:<kind> instead stands on top of that prop and leaves it in place. build_map only reads recorded assets and never uploads; an asset that fails to load builds the set piece instead with a warning naming the asset id and error, except an onto:prop:<kind> mesh, which builds nothing in its place and warns the same way; a hero prop with no recorded asset keeps its set piece and a warning says to generate and upload it from a clone of the roblox-kit repo. Each other prop whose kind's prop-<kind> recipe has a recorded asset is that mesh instead, stretched on each axis to the prop's box; a kind with no recorded asset keeps its ProceduralModel, with no warning. ` +
    `The map is one Model named mapId under Workspace.${config.mapsFolderName}, and mapId is the handle that later tools take. ` +
    `The handle lasts while that Model exists in the open place, including across calls and saves. Calling build_map again with the same mapId ` +
    `replaces the Model and clears the terrain its previous build filled. A terrain fill of shape heightmap { center, size, material, layers, seed, noiseScaleStuds, erosion } is seeded fractal noise with particle hydraulic erosion inside its box (minimum corner and size on the 4-stud voxel grid, size.y the tallest height above the box bottom), written with WriteVoxels in chunks after the shell phase: sand low, snow high, rock on steep slopes, grass elsewhere, and the fill's material below. Studio may not offer an undo step (undo recording is unavailable to execute_luau). ` +
    `A style with ambientEffects also gets, per room of a listed type (or every room), a ParticleEmitter at the floor's center or a Beam across the room from west to east under Attachments on the floor part, textured with its sprite (drawn by the repo's own code and recorded by hash in hero-assets.json); a sprite with no recorded asset builds its emitters untextured with a warning. A style with idleAnimations also gives each set piece of a listed kind sway attributes and the map one server Script that sways them about the top or bottom of their box during play. The build runs in seven phases (shell, floors and ceilings, openings, surfaces, props, lighting, ambient effects), reporting progress after each; a phase that fails stops the build and may leave a partial Model, which building again with the same mapId replaces. ` +
    `Returns { mapId, partCount, phases, bounds, zones, warnings, lookIssues, texturePixels }: the parts per phase, the studs bounds of the whole map and of each room (zone), one warning per set piece skipped because its room has no space for it, and one per hero prop not built, saying why, and one per hero asset that fails to load (its set piece is built instead; nothing for an onto:prop:<kind> mesh), and one per ambient sprite with no recorded asset; lookIssues lists plan-time look problems of a styled map (prop scale, dead gaps, walkway and doorway widths, prop facing and density, colors outside the palette, too little lightness separation between floor, wall, ceiling and trim), computed before Studio is touched, warning only and never failing the build, where walkway and doorway issues carry a suggestedSpecPatch, a JSON merge patch of this input; texturePixels is the pixel count of the plan's distinct material-map images (at the baked map size) and ambient sprites, each counted once, 0 with recorded assets off.`,
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
