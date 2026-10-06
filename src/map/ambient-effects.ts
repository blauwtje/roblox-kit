import { config } from "../config.ts";
import type { AmbientEffect, SpriteName } from "../style/preset-schema.ts";
import type { PartRecord, Vector } from "./map-layout.ts";
import type { MapSpec } from "./map-spec.ts";

/** Studs a beam stays inside its room's floor edges. */
const beamInsetStuds = 2;

/** One ambient effect in one room for `build-map.luau`: hung from Attachments under the room's floor part. */
export type AmbientEffectRecord = AmbientEffect & {
  zone: string;
  /** Name of the floor part of the zone that holds the effect's Attachments. */
  part: string;
  /** The emitter's position, or the beam's west end. */
  position: Vector;
  /** The beam's east end; absent on particles. */
  endPosition?: Vector;
  /** The sprite's ContentId; absent builds the emitter untextured. */
  texture?: string;
};

/**
 * The ambient effects of the style in each room whose type the effect names (every room when it names none):
 * particles at the floor's center, beams across the floor from west to east, both `heightStuds` above the floor
 * top. Each carries its sprite's texture from `textures` when one is recorded. Particle rates are scaled down together
 * when the map's alive particles would pass `config.maxAliveParticlesPerMap`.
 */
export function ambientEffectsOf(
  spec: MapSpec,
  parts: PartRecord[],
  effects: AmbientEffect[],
  textures: Partial<Record<SpriteName, string>>,
): AmbientEffectRecord[] {
  return capAliveParticles(placeAmbientEffects(spec, parts, effects, textures));
}

/** Scales every particle rate by one factor when the map's alive particles (rate times lifetime, summed) pass `config.maxAliveParticlesPerMap`. */
function capAliveParticles(records: AmbientEffectRecord[]): AmbientEffectRecord[] {
  let alive = 0;
  for (const record of records) {
    if (record.kind === "particles") alive += record.rate * record.lifetimeSeconds;
  }
  if (alive <= config.maxAliveParticlesPerMap) return records;
  const scale = config.maxAliveParticlesPerMap / alive;
  return records.map((record) =>
    record.kind === "particles" ? { ...record, rate: record.rate * scale } : record,
  );
}

function placeAmbientEffects(
  spec: MapSpec,
  parts: PartRecord[],
  effects: AmbientEffect[],
  textures: Partial<Record<SpriteName, string>>,
): AmbientEffectRecord[] {
  return spec.rooms.flatMap((room) => {
    const floor = parts.find((part) => part.kind === "floor" && part.room === room.name);
    if (floor === undefined) return [];
    const floorTop = floor.position.y + floor.size.y / 2;
    return effects
      .filter(
        (effect) =>
          effect.roomTypes === undefined ||
          (room.roomType !== undefined && effect.roomTypes.includes(room.roomType)),
      )
      .map((effect): AmbientEffectRecord => {
        const y = floorTop + effect.heightStuds;
        const texture = textures[effect.sprite];
        const placed = { ...effect, zone: room.name, part: floor.name };
        const textured = texture === undefined ? {} : { texture };
        if (effect.kind === "particles") {
          return {
            ...placed,
            ...textured,
            position: { x: floor.position.x, y, z: floor.position.z },
          };
        }
        const halfSpan = Math.max(0, floor.size.x / 2 - beamInsetStuds);
        return {
          ...placed,
          ...textured,
          position: { x: floor.position.x - halfSpan, y, z: floor.position.z },
          endPosition: { x: floor.position.x + halfSpan, y, z: floor.position.z },
        };
      });
  });
}

/** One warning per sprite the effects use that has no recorded texture. */
export function missingSpriteWarnings(
  effects: AmbientEffect[],
  textures: Partial<Record<SpriteName, string>>,
): string[] {
  const missing = [...new Set(effects.map((effect) => effect.sprite))].filter(
    (sprite) => textures[sprite] === undefined,
  );
  return missing.map(
    (sprite) =>
      `Ambient sprite "${sprite}" has no recorded asset, so its emitters are built untextured; draw and upload it with \`node scripts/sprites.ts --upload\` from a clone of the roblox-kit repo.`,
  );
}
