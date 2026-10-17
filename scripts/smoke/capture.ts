import { config } from "../../src/config.ts";
import { captureZonesTool } from "../../src/map/capture-zones-tool.ts";
import { type StudioConnection } from "../../src/studio/studio-connection.ts";
import { callRealTool, expectEqual } from "./shared.ts";
import { smokeMapSpec } from "./build.ts";

export async function probeCaptureZones(connection: StudioConnection): Promise<string> {
  const { output, content } = await callRealTool(
    captureZonesTool,
    { mapId: smokeMapSpec.mapId },
    connection,
  );
  const images = content.filter((block) => block.type === "image");
  const zoneNames = smokeMapSpec.rooms.map((room) => room.name).sort();
  // The cutaway of the whole map comes first, then views a and b of the zones that fit
  // config.maxImagesPerCall; the rest come back in remainingZones.
  const fittingZones = Math.floor((config.maxImagesPerCall - 1) / 2);
  const firstZones = zoneNames.slice(0, fittingZones);
  const laterZones = zoneNames.slice(fittingZones);
  expectEqual(
    "capture_zones shots",
    output.shots.map((shot) => `${shot.zone}:${shot.view}`),
    [`${smokeMapSpec.mapId}:top`, ...firstZones.flatMap((name) => [`${name}:a`, `${name}:b`])],
  );
  expectEqual("capture_zones image count", images.length, 1 + firstZones.length * 2);
  expectEqual("capture_zones remainingZones", output.remainingZones, laterZones);
  const rest = await callRealTool(
    captureZonesTool,
    { mapId: smokeMapSpec.mapId, zones: laterZones, cutaway: false },
    connection,
  );
  expectEqual(
    "capture_zones follow-up shots",
    rest.output.shots.map((shot) => `${shot.zone}:${shot.view}`),
    laterZones.flatMap((name) => [`${name}:a`, `${name}:b`]),
  );
  expectEqual("capture_zones follow-up remainingZones", rest.output.remainingZones, []);
  // The output schema already requires a positive integer width and height per shot.
  const sizes = [...output.shots, ...rest.output.shots].map(
    (shot) => `${String(shot.width)}x${String(shot.height)}`,
  );
  const eye = await callRealTool(
    captureZonesTool,
    { mapId: smokeMapSpec.mapId, views: ["eye"], cutaway: false },
    connection,
  );
  // The eye view of each room, shot with ceilings shown.
  expectEqual(
    "capture_zones eye shots",
    eye.output.shots.map((shot) => `${shot.zone}:${shot.view}`),
    zoneNames.map((name) => `${name}:eye`),
  );
  expectEqual(
    "capture_zones eye image count",
    eye.content.filter((block) => block.type === "image").length,
    zoneNames.length,
  );
  expectEqual("capture_zones eye remainingZones", eye.output.remainingZones, []);
  return `${String(images.length)} images (cap ${String(config.maxImagesPerCall)}), the top-down cutaway then two views per zone, ${String(rest.output.shots.length)} more in a follow-up call, plus ${String(zoneNames.length)} eye views, sizes ${sizes.join(" ")}, warnings ${JSON.stringify(output.warnings)}`;
}
