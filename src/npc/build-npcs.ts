import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { StudioConnection } from "../studio/studio-connection.ts";
import type { Preset } from "../style/preset-schema.ts";
import { npcConfig } from "./npc-config.ts";
import type { NpcRecord } from "./plan-npcs.ts";
import type { RouteGraph } from "./route-graph.ts";

const buildResultSchema = z.object({
  built: z.number().int().nonnegative(),
  characterPath: z.enum(["avatar", "rig"]),
  warnings: z.array(z.string()),
});

export type BuildNpcsResult = z.infer<typeof buildResultSchema>;

export interface BuildNpcsRequest {
  connection: StudioConnection;
  studioId: string;
  mapId: string;
  roster: readonly NpcRecord[];
  graph: RouteGraph;
  preset: Preset;
}

const runtimeUrl = new URL("../../luau/npc-runtime.luau", import.meta.url);

type Role = NonNullable<Preset["npcRoles"]>[string];

/** What Luau needs for one NPC: the record plus its role's outfit, speed and chat lines. */
export function npcArguments(roster: readonly NpcRecord[], roles: Record<string, Role>) {
  return roster.map((npc) => {
    const role = roles[npc.role];
    if (role === undefined) throw new Error(`NPC ${npc.id} has undeclared role "${npc.role}"`);
    const outfit = role.outfits[npc.outfitIndex % role.outfits.length] ?? role.outfits[0];
    if (outfit === undefined) throw new Error(`role "${npc.role}" has no outfits`);
    return {
      ...npc,
      outfit,
      speed: (role.speed.min + role.speed.max) / 2,
      chatLines: role.chatLines,
    };
  });
}

/** Builds the posed NPCs of one map in edit mode and installs the pooled client script that animates them. */
export async function buildNpcs(request: BuildNpcsRequest): Promise<BuildNpcsResult> {
  const roles = request.preset.npcRoles ?? {};
  return runLuauFile({
    connection: request.connection,
    studioId: request.studioId,
    fileName: "build-npcs.luau",
    datamodelType: "Edit",
    arguments: {
      mapId: request.mapId,
      mapsFolderName: config.mapsFolderName,
      npcs: npcArguments(request.roster, roles),
      graph: request.graph,
      sightRadius: npcConfig.sightRadiusStuds,
      bubbleInterval: npcConfig.bubbleIntervalSeconds,
      clientScriptSource: await readFile(runtimeUrl, "utf8"),
    },
    resultSchema: buildResultSchema,
  });
}
