import { z } from "zod";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { StudioConnection } from "../studio/studio-connection.ts";
import type { Preset } from "../style/preset-schema.ts";

/** What `apply-lighting.luau` reports: whether this apply took the snapshot or found one already stored. */
const appliedLightingSchema = z.strictObject({ snapshotTaken: z.boolean() });

export type AppliedLighting = z.infer<typeof appliedLightingSchema>;

export interface ApplyLightingRequest {
  connection: StudioConnection;
  studioId: string;
  mapsFolderName: string;
  /** The built map whose Model holds the snapshot. */
  mapId: string;
  /** The recipe to write; absent, the stored snapshot is restored and nothing is written. */
  recipe?: Preset["lighting"];
}

/**
 * Applies a style's lighting recipe to Lighting in the open place. The first apply stores the
 * previous values on the map Model; later applies restore that snapshot before writing the recipe.
 * Without a recipe it only restores the stored snapshot.
 */
export function applyLighting(request: ApplyLightingRequest): Promise<AppliedLighting> {
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
