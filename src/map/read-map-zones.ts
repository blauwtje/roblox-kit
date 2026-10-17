import { z } from "zod";
import { config } from "../config.ts";

const vectorSchema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });

export const mapZonesSchema = z.strictObject({
  zones: z.array(z.strictObject({ name: z.string(), min: vectorSchema, max: vectorSchema })),
});

export function mapZonesBatchPart(mapId: string) {
  return {
    fileName: "read-map-zones.luau",
    arguments: {
      mapId,
      mapsFolderName: config.mapsFolderName,
      floorNameSuffix: config.floorNameSuffix,
      spawnNameSuffix: config.spawnNameSuffix,
      wallNameInfix: config.wallNameInfix,
    },
    resultSchema: mapZonesSchema,
  };
}
