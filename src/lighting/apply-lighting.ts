import { z } from "zod";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { StudioConnection } from "../studio/studio-connection.ts";
import type { Preset } from "../style/preset-schema.ts";

/** What `apply-lighting.luau` reports: whether this apply took the snapshot or found one already stored. */
const appliedLightingSchema = z.strictObject({ snapshotTaken: z.boolean() });

export type AppliedLighting = z.infer<typeof appliedLightingSchema>;

/**
 * What `apply-lighting.luau` reports in `removing` mode. Luau drops a nil `restored` from the JSON, so
 * an absent key reads as null.
 */
const removedLightingSchema = z.strictObject({
  restored: z
    .enum(["original", "map"])
    .nullish()
    .transform((restored) => restored ?? null),
  remainingStyledMaps: z.array(z.string()),
});

export type RemovedLighting = z.infer<typeof removedLightingSchema>;

export interface ApplyLightingRequest {
  connection: StudioConnection;
  studioId: string;
  mapsFolderName: string;
  /** The built map whose Model holds the snapshot. */
  mapId: string;
  /** The recipe to write; absent, the stored snapshot is restored and nothing is written. */
  recipe?: Preset["lighting"];
}

export interface RemoveLightingRequest {
  connection: StudioConnection;
  studioId: string;
  mapsFolderName: string;
  /** The map about to be removed; its Model must still exist. */
  mapId: string;
  removing: true;
}

/**
 * Applies a style's lighting recipe to Lighting in the open place. The first apply stores the
 * previous values on the map Model (and, once, on the maps folder as the place's original lighting); later applies restore that snapshot before writing the recipe.
 * Without a recipe it only restores the stored snapshot.
 */
export function applyLighting(request: ApplyLightingRequest): Promise<AppliedLighting>;
/**
 * The `removing` mode, run before the map Model is destroyed: when the map is the last styled map the
 * place's original lighting is restored (`restored: "original"`) and its folder attribute cleared; an
 * older place with none saved gets the map's own snapshot back (`"map"`). With other styled maps left, or
 * an unstyled map, Lighting stays as it is (`null`) and `remainingStyledMaps` names the others.
 */
export function applyLighting(request: RemoveLightingRequest): Promise<RemovedLighting>;
export function applyLighting(
  request: ApplyLightingRequest | RemoveLightingRequest,
): Promise<AppliedLighting | RemovedLighting> {
  if ("removing" in request) {
    return runLuauFile({
      connection: request.connection,
      studioId: request.studioId,
      fileName: "apply-lighting.luau",
      datamodelType: "Edit",
      arguments: {
        mapId: request.mapId,
        mapsFolderName: request.mapsFolderName,
        removing: true,
      },
      resultSchema: removedLightingSchema,
    });
  }
  return runLuauFile({
    connection: request.connection,
    studioId: request.studioId,
    fileName: "apply-lighting.luau",
    datamodelType: "Edit",
    arguments: {
      mapId: request.mapId,
      mapsFolderName: request.mapsFolderName,
      recipe: request.recipe,
    },
    resultSchema: appliedLightingSchema,
  });
}
