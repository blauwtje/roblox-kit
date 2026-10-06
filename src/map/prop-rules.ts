import { z } from "zod";
import { config } from "../config.ts";
import type { Preset } from "../style/preset-schema.ts";
import type { CheckIssue } from "./check-report-store.ts";
import type { RoomSpec } from "./map-spec.ts";

const vectorSchema = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });

/** One prop of a built map as `read-props.luau` reports it. */
export const propRecordSchema = z.strictObject({
  /** Full name of the prop's model, such as `Workspace.RobloxKitMaps.arena.bench-1`. */
  path: z.string().min(1),
  /** The prop kind, the key of the preset's `propRules`. */
  kind: z.string().min(1),
  /** The size the prop was generated at, in studs; `y` is its height. */
  size: vectorSchema,
  /** Where the prop's pivot stands, in studs. */
  position: vectorSchema,
  /** Turn about the Y axis in degrees. */
  yaw: z.number(),
  /** False when the prop's up axis is tilted off the world's. */
  upright: z.boolean(),
});

export type PropRecord = z.infer<typeof propRecordSchema>;

/** One part directly under the map Model as `read-props.luau` reports it, with whether it shows a texture. */
export const surfaceRecordSchema = z.strictObject({
  path: z.string().min(1),
  size: vectorSchema,
  position: vectorSchema,
  /** True when the part has a SurfaceAppearance, Texture or Decal, a material variant or a textured material. */
  textured: z.boolean(),
});

/** One light of the map: where its Attachment or part stands, in studs. */
export const lightRecordSchema = z.strictObject({
  path: z.string().min(1),
  position: vectorSchema,
});

/** One MeshPart of a hero prop with the bevel in studs `build-map.luau` set from the recipe; 0 is no bevel. */
export const heroPartRecordSchema = z.strictObject({
  path: z.string().min(1),
  kind: z.string().min(1),
  position: vectorSchema,
  bevel: z.number().min(0),
});

/** Everything `read-props.luau` reports about one built map. */
export const mapRecordsSchema = z.strictObject({
  props: z.array(propRecordSchema),
  surfaces: z.array(surfaceRecordSchema),
  lights: z.array(lightRecordSchema),
  heroParts: z.array(heroPartRecordSchema),
});

export type MapRecords = z.infer<typeof mapRecordsSchema>;

/** A yaw within this many degrees of a multiple of 90 is on the grid; it absorbs float error, not a turn. */
const GRID_TOLERANCE_DEGREES = 0.5;

const GRID_DEGREES = 90;

function isOnGrid(yaw: number): boolean {
  const remainder = Math.abs(yaw) % GRID_DEGREES;
  return Math.min(remainder, GRID_DEGREES - remainder) <= GRID_TOLERANCE_DEGREES;
}

function scaleIssue(
  prop: PropRecord,
  heightRatio: { min: number; max: number },
  avatarHeight: { min: number; max: number },
): CheckIssue | undefined {
  // Out of bounds against the shortest avatar is too tall, against the tallest too short.
  const tallestRatio = prop.size.y / avatarHeight.min;
  const shortestRatio = prop.size.y / avatarHeight.max;
  const tooTall = tallestRatio > heightRatio.max;
  if (!tooTall && shortestRatio >= heightRatio.min) {
    return undefined;
  }
  const limit = tooTall
    ? `over ${String(heightRatio.max)} of a ${String(avatarHeight.min)}-stud avatar`
    : `under ${String(heightRatio.min)} of a ${String(avatarHeight.max)}-stud avatar`;
  const ratio = tooTall ? tallestRatio : shortestRatio;
  return {
    kind: "scale",
    parts: [prop.path],
    position: prop.position,
    detail: `${prop.kind} is ${String(prop.size.y)} studs tall, ${String(Math.round(ratio * 100) / 100)} of the avatar's height, ${limit}.`,
  };
}

function rotationIssue(prop: PropRecord): CheckIssue | undefined {
  if (prop.upright && isOnGrid(prop.yaw)) {
    return undefined;
  }
  const turn = prop.upright
    ? `is turned ${String(Math.round(prop.yaw * 10) / 10)} degrees, off the 90-degree grid`
    : "is tilted off upright";
  return {
    kind: "rotation",
    parts: [prop.path],
    position: prop.position,
    detail: `${prop.kind} ${turn}, and its prop rule does not allow free rotation.`,
  };
}

/** The scale and rotation issues of props against the preset's rules; a kind without a rule is not checked. */
export function findPropIssues(props: PropRecord[], preset: Preset): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const prop of props) {
    const rule = preset.propRules[prop.kind];
    if (rule === undefined) {
      continue;
    }
    const scale =
      rule.heightRatio === undefined
        ? undefined
        : scaleIssue(prop, rule.heightRatio, preset.sizeRules.avatarHeight);
    const rotation = rule.freeRotation ? undefined : rotationIssue(prop);
    for (const issue of [scale, rotation]) {
      if (issue !== undefined) {
        issues.push(issue);
      }
    }
  }
  return issues;
}

/** A flat part (its two longest sides both over `config.maxUntexturedSurfaceStuds`) with no texture is one issue. */
export function findSurfaceIssues(surfaces: MapRecords["surfaces"]): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const limit = config.maxUntexturedSurfaceStuds;
  for (const surface of surfaces) {
    const [, second = 0, longest = 0] = [surface.size.x, surface.size.y, surface.size.z].sort(
      (a, b) => a - b,
    );
    if (surface.textured || second <= limit) {
      continue;
    }
    issues.push({
      kind: "untextured",
      parts: [surface.path],
      position: surface.position,
      detail: `A ${String(longest)} by ${String(second)} stud surface has no texture, texture-bearing material or material variant; the limit is ${String(limit)} studs on both sides.`,
    });
  }
  return issues;
}

/** One issue per room with no light inside its footprint. */
export function findLightIssues(rooms: RoomSpec[], lights: MapRecords["lights"]): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const room of rooms) {
    const lit = lights.some(
      (light) =>
        Math.abs(light.position.x - room.x) <= room.width / 2 &&
        Math.abs(light.position.z - room.z) <= room.depth / 2,
    );
    if (!lit) {
      issues.push({
        kind: "unlit",
        parts: [],
        position: { x: room.x, y: 0, z: room.z },
        detail: `Room "${room.name}" has no light source inside its footprint.`,
      });
    }
  }
  return issues;
}

/** One issue per hero MeshPart whose surface role has a shape with no bevel in its recipe. */
export function findBevelIssues(heroParts: MapRecords["heroParts"]): CheckIssue[] {
  return heroParts
    .filter((part) => part.bevel <= 0)
    .map((part) => ({
      kind: "unbevelled" as const,
      parts: [part.path],
      position: part.position,
      detail: `A ${part.kind} MeshPart has a shape with no bevel in its recipe, so its edges catch no light.`,
    }));
}
