import { z } from "zod";
import { config } from "../config.ts";
import { applyLighting } from "../lighting/apply-lighting.ts";
import { inlineRequires } from "../luau/inline-requires.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolContext } from "../server/tool-definition.ts";
import { selectStudio } from "../studio/studio-connection.ts";
import type { BuildPhase, BuildPhaseName } from "./build-phases.ts";
import type { BuildPlan, LightRecord } from "./build-plan.ts";

export const builtPhaseSchema = z.strictObject({
  partCount: z.number().int(),
  replaced: z.boolean().optional(),
  heroLoadFailures: z
    .array(z.strictObject({ kind: z.string(), assetId: z.string(), error: z.string() }))
    .optional(),
});

export type HeroLoadFailure = NonNullable<
  z.infer<typeof builtPhaseSchema>["heroLoadFailures"]
>[number];

const phaseFiles: Record<BuildPhaseName | "terrain", string> = {
  shell: "build/shell.luau",
  terrain: "build/shell.luau",
  "floors and ceilings": "build/parts.luau",
  openings: "build/parts.luau",
  surfaces: "build/parts.luau",
  props: "build/props.luau",
  lighting: "build/lighting.luau",
  "ambient effects": "build/ambient.luau",
};

function inlinedGenerators(generators: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(generators).map(([kind, source]) => [
      kind,
      inlineRequires(source, new URL(`../../luau/props/${kind}.luau`, import.meta.url)),
    ]),
  );
}

function phaseArguments(phase: BuildPhase<LightRecord>, plan: BuildPlan): Record<string, unknown> {
  const { build } = plan;
  const base = { phase: phase.name, mapId: build.mapId, mapsFolderName: config.mapsFolderName };
  const argumentsByPhase: Record<BuildPhaseName, Record<string, unknown>> = {
    shell: {
      parts: phase.parts,
      terrainFills: build.terrainFills,
      variants: build.variants,
      terrainOverrides: build.terrainOverrides,
      materials: build.materials,
    },
    "floors and ceilings": {
      parts: phase.parts,
      variants: build.variants,
      ceilingTag: config.ceilingTag,
    },
    openings: { parts: phase.parts, variants: build.variants },
    surfaces: { parts: phase.parts, variants: build.variants },
    props: {
      props: phase.parts,
      generators: inlinedGenerators(build.generators),
      noShadowSizeStuds: config.noShadowPropSizeStuds,
      heroProps: [...build.heroProps, ...build.trimMeshes, ...build.pendantMeshes],
      ...build.idle,
    },
    lighting: {
      lights: phase.parts,
      ceilingTag: config.ceilingTag,
      ceilingDropStuds: config.lightCeilingDropStuds,
      fixtureSizeStuds: config.lightFixtureSizeStuds,
    },
    "ambient effects": { effects: phase.parts },
  };
  return { ...base, ...argumentsByPhase[phase.name] };
}

function withoutGlow(light: LightRecord): LightRecord {
  if (light.fixture?.glow === undefined) return light;
  const { position, size, pendant } = light.fixture;
  return { ...light, fixture: { position, size, pendant } };
}

export function heroLoadWarning(
  failure: HeroLoadFailure,
  plan: BuildPlan,
): { warning: string; pendantMeshFailed: boolean } {
  const { heroProps, trimMeshes, pendantMeshes } = plan.build;
  const hero = heroProps.find((candidate) => candidate.assetId === failure.assetId);
  if (hero !== undefined && hero.fallback === undefined) {
    return {
      warning: `Hero prop ${failure.kind} (asset ${failure.assetId}) failed to load: ${failure.error}; nothing is built in its place.`,
      pendantMeshFailed: false,
    };
  }
  const fallback = hero?.fallback?.kind;
  if (fallback === undefined && pendantMeshes.some((mesh) => mesh.assetId === failure.assetId)) {
    return {
      warning: `Pendant mesh (asset ${failure.assetId}) failed to load: ${failure.error}; its kit fixture box is built instead.`,
      pendantMeshFailed: true,
    };
  }
  if (fallback === undefined && trimMeshes.some((mesh) => mesh.assetId === failure.assetId)) {
    return {
      warning: `Trim mesh ${failure.kind} (asset ${failure.assetId}) failed to load: ${failure.error}; its kit trim is built instead.`,
      pendantMeshFailed: false,
    };
  }
  return {
    warning: `Hero prop ${failure.kind} (asset ${failure.assetId}) failed to load: ${failure.error}; its ${fallback ?? "set piece"} set piece is built instead.`,
    pendantMeshFailed: false,
  };
}

async function writeTerrain(plan: BuildPlan, context: ToolContext, studioId: string) {
  for (const terrainChunk of plan.chunks) {
    await runLuauFile({
      connection: context.studio,
      studioId,
      fileName: phaseFiles.terrain,
      datamodelType: "Edit",
      arguments: {
        phase: "terrain",
        mapId: plan.mapId,
        mapsFolderName: config.mapsFolderName,
        terrainChunk,
      },
      resultSchema: builtPhaseSchema,
    });
  }
}

async function runPhase(
  phase: BuildPhase<LightRecord>,
  plan: BuildPlan,
  target: { context: ToolContext; studioId: string },
) {
  const { context, studioId } = target;
  const built = await runLuauFile({
    connection: context.studio,
    studioId,
    fileName: phaseFiles[phase.name],
    datamodelType: "Edit",
    arguments: phaseArguments(phase, plan),
    resultSchema: builtPhaseSchema,
  });
  if (phase.name === "shell") {
    await writeTerrain(plan, context, studioId);
  }
  const reports = (built.heroLoadFailures ?? []).map((failure) => heroLoadWarning(failure, plan));
  if (phase.name === "lighting") {
    await applyLighting({
      connection: context.studio,
      studioId,
      mapsFolderName: config.mapsFolderName,
      mapId: plan.mapId,
      recipe: plan.lighting,
    });
  }
  return { partCount: built.partCount, reports };
}

export async function runBuildPlan(
  plan: BuildPlan,
  context: ToolContext,
): Promise<{ partCount: number; warnings: string[] }> {
  const studioId = await selectStudio(context.studio, plan.studioId);
  const warnings = [...plan.warnings];
  let partCount = 0;
  let pendantMeshFailed = false;
  for (const [index, builtPhase] of plan.phases.entries()) {
    const phase =
      builtPhase.name === "lighting" && pendantMeshFailed
        ? { ...builtPhase, parts: (builtPhase.parts as LightRecord[]).map(withoutGlow) }
        : builtPhase;
    try {
      const done = await runPhase(phase, plan, { context, studioId });
      partCount = done.partCount;
      warnings.push(...done.reports.map((report) => report.warning));
      pendantMeshFailed ||= done.reports.some((report) => report.pendantMeshFailed);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Building map "${plan.mapId}" failed in the "${phase.name}" phase; the Model may be partial: ${reason}`,
        { cause: error },
      );
    }
    await context.reportProgress?.(index + 1, plan.phases.length, phase.name);
  }
  return { partCount, warnings };
}
