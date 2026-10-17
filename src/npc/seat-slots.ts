import { config } from "../config.ts";
import type { PropRecord } from "../map/prop-placement.ts";
import type { Vector } from "../map/map-layout.ts";
import { npcConfig } from "./npc-config.ts";

/** One place an NPC can sit: `position` is the seat surface, `yaw` the degrees about Y that turn the sitter's -Z front. */
export interface SeatSlot {
  position: Vector;
  yaw: number;
  propSeed: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Evenly spaced seats along each bench's width, centered on it and facing the way the bench does. */
export function planSeatSlots(props: readonly PropRecord[]): SeatSlot[] {
  const slots: SeatSlot[] = [];
  for (const prop of props) {
    if (prop.kind !== "bench") continue;
    const yaw = prop.yaw ?? 0;
    const radians = (yaw * Math.PI) / 180;
    const along = { x: Math.cos(radians), z: -Math.sin(radians) };
    const count = Math.max(1, Math.floor(prop.size.x / npcConfig.seatSpacingStuds));
    const seatY = prop.pivot.y - prop.size.y / 2 + config.propAnchors.seatHeightStuds;
    for (let index = 0; index < count; index++) {
      const offset = (index - (count - 1) / 2) * npcConfig.seatSpacingStuds;
      slots.push({
        position: {
          x: round(prop.pivot.x + along.x * offset),
          y: round(seatY),
          z: round(prop.pivot.z + along.z * offset),
        },
        yaw,
        propSeed: prop.seed,
      });
    }
  }
  return slots;
}
