import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { runLuauFile } from "../../src/luau/run-luau-file.ts";
import { selectStudio, type StudioConnection } from "../../src/studio/studio-connection.ts";

const npcProbeFile = new URL("../../.roblox-kit/npc-probe.json", import.meta.url);

const npcProbeSchema = z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() }));

/** Records the pcall result of each NPC avatar and animation call to `.roblox-kit/npc-probe.json`; a failed call is data, not a failed step. */
export async function probeNpcCapabilities(connection: StudioConnection): Promise<string> {
  const studioId = await selectStudio(connection, undefined);
  const results = await runLuauFile({
    connection,
    studioId,
    fileName: "probe-npc-capabilities.luau",
    datamodelType: "Edit",
    arguments: null,
    resultSchema: npcProbeSchema,
  });
  await mkdir(new URL("./", npcProbeFile), { recursive: true });
  await writeFile(npcProbeFile, `${JSON.stringify(results, null, 2)}\n`);
  return results.map((result) => `${result.name}: ${result.ok ? "ok" : "failed"}`).join("; ");
}
