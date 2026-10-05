import { z } from "zod";
import { config } from "../config.ts";
import { applyLighting } from "../lighting/apply-lighting.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio } from "../studio/studio-connection.ts";

/** The surface roles whose MaterialVariants `build_map` names `<mapId>-<role>`; the same five as the preset schema. */
const surfaceRoles = ["floor", "wall", "trim", "ceiling", "accent"];

const removeMapInput = z.strictObject({
  /** The mapId that `build_map` returned. */
  mapId: z.string().min(1),
  /** Which Studio holds the map; optional while exactly one is connected. */
  studioId: z.string().min(1).optional(),
});

const removeMapOutput = z.strictObject({
  mapId: z.string(),
  lighting: z.strictObject({
    /** `original` is the place's saved lighting, `map` the removed map's own snapshot (older place), null none. */
    restored: z.enum(["original", "map"]).nullable(),
    /** The styled maps still built, which is why lighting stayed as it is when this list is not empty. */
    remainingStyledMaps: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
});

/** What `remove-map.luau` reports. */
const removedSchema = z.strictObject({ removed: z.literal(true) });

export const removeMapTool: ToolDefinition<typeof removeMapInput, typeof removeMapOutput> = {
  name: "remove_map",
  title: "Remove a built map",
  description:
    `Removes a map that build_map built: fills its terrain with Air, destroys its MaterialVariants and its Model under Workspace.${config.mapsFolderName}, and destroys that folder when it is left empty. ` +
    `A mapId that is not a Model under Workspace.${config.mapsFolderName} fails the call before any change. ` +
    `Lighting returns to the place's original when the last styled map goes; while another styled map remains, lighting stays as it is and a warning names the remaining maps. ` +
    `Returns { mapId, lighting: { restored, remainingStyledMaps }, warnings }.`,
  inputSchema: removeMapInput,
  outputSchema: removeMapOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(input, context) {
    const studioId = await selectStudio(context.studio, input.studioId);
    // The lighting call fails on a missing map before it changes anything, so the removal below never runs for one.
    const lighting = await applyLighting({
      connection: context.studio,
      studioId,
      mapsFolderName: config.mapsFolderName,
      mapId: input.mapId,
      removing: true,
    });
    await runLuauFile({
      connection: context.studio,
      studioId,
      fileName: "remove-map.luau",
      datamodelType: "Edit",
      arguments: { mapId: input.mapId, mapsFolderName: config.mapsFolderName, roles: surfaceRoles },
      resultSchema: removedSchema,
    });
    const warnings: string[] = [];
    if (lighting.remainingStyledMaps.length > 0) {
      warnings.push(
        `Lighting was left as it is because styled maps remain: ${lighting.remainingStyledMaps.join(", ")}. Removing the last one restores the original lighting.`,
      );
    }
    if (lighting.restored === "map") {
      warnings.push(
        `No original lighting was saved on Workspace.${config.mapsFolderName} (the place was built by an older version), so the lighting from before this map's own styling was restored.`,
      );
    }
    return toolResult({ mapId: input.mapId, lighting, warnings });
  },
};
