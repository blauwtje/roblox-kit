import type { HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import { trimRecipeKind } from "../hero-props/prop-recipes.ts";
import type { Preset } from "../style/preset-schema.ts";
import { cachedAssetId } from "./declared-meshes.ts";
import type { Vector } from "./map-layout.ts";
import type { DetailPart } from "./room-details.ts";

/** A profile mesh that replaces one trim box: its recorded asset placed like the box, with the box as its fallback. */
export interface TrimMeshRecord {
  kind: string;
  assetId: string;
  pivot: Vector;
  yaw: number;
  roll: number;
  size: Vector;
  surfaces: Record<string, { color: string; material: string }>;
  fit: "stretch";
  fallbackPart: DetailPart;
}

/**
 * Each detail with a profile whose recipe has a recorded asset as a mesh stretched along its run, and the details
 * left as boxes: the others, and every one when its profile has no recorded upload (nothing is uploaded here).
 */
export async function trimMeshesOf(
  details: DetailPart[],
  preset: { base: Preset; style: Preset },
  sources: HeroPropSources = {},
): Promise<{ details: DetailPart[]; trimMeshes: TrimMeshRecord[] }> {
  const lookup = { cache: new Map<string, string | undefined>(), base: preset.base, sources };
  const kept: DetailPart[] = [];
  const trimMeshes: TrimMeshRecord[] = [];
  const { color, material } = preset.style.surfaces.trim;
  for (const detail of details) {
    const { profile } = detail;
    if (profile === undefined) {
      kept.push(detail);
      continue;
    }
    const assetId = await cachedAssetId(lookup, trimRecipeKind(profile.kind));
    if (assetId === undefined) {
      kept.push(detail);
      continue;
    }
    trimMeshes.push({
      kind: trimRecipeKind(profile.kind),
      assetId,
      pivot: detail.position,
      yaw: profile.yaw,
      roll: profile.roll,
      size: profile.size,
      surfaces: { trim: { color, material } },
      fit: "stretch",
      fallbackPart: detail,
    });
  }
  return { details: kept, trimMeshes };
}
