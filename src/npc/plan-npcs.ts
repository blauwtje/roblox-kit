import { config } from "../config.ts";
import type { MapSpec, RoomSpec } from "../map/map-spec.ts";
import type { Vector } from "../map/map-layout.ts";
import type { PropRecord } from "../map/prop-placement.ts";
import { roomFrame } from "../map/room-frame.ts";
import { createSeededRandom } from "../shared/seeded-random.ts";
import type { Preset } from "../style/preset-schema.ts";
import { npcConfig } from "./npc-config.ts";
import type { RouteGraph } from "./route-graph.ts";
import { planSeatSlots } from "./seat-slots.ts";
import type { SeatSlot } from "./seat-slots.ts";

const maxWalkers = 6;

export interface NpcRecord {
  id: string;
  role: string;
  outfitIndex: number;
  behavior: "idle" | "sit" | "chat" | "walk";
  position: Vector;
  yaw: number;
  seatId?: number;
  route?: { x: number; z: number }[];
  phase: number;
}

export interface NpcPlanInput {
  spec: MapSpec;
  preset: Preset;
  props: readonly PropRecord[];
  graph: RouteGraph;
}

type Random = () => number;
type Role = NonNullable<Preset["npcRoles"]>[string];

interface RoomPool {
  spots: number[];
  seats: number[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function pickWeighted(weights: [string, number][], random: Random): string {
  let remaining = random() * weights.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of weights) {
    remaining -= weight;
    if (remaining < 0) return name;
  }
  return "idle";
}

function take(items: number[], random: Random): number | undefined {
  return items.splice(Math.floor(random() * items.length), 1)[0];
}

function neighbor(edge: [number, number], node: number): number | undefined {
  if (edge[0] === node) return edge[1];
  return edge[1] === node ? edge[0] : undefined;
}

function findPath(graph: RouteGraph, from: number, to: number): number[] | undefined {
  const before = new Map<number, number>([[from, from]]);
  const queue = [from];
  for (let head = 0; head < queue.length && !before.has(to); head++) {
    const current = queue[head] as number;
    const fresh = graph.edges
      .map((edge) => neighbor(edge, current))
      .filter((next): next is number => next !== undefined && !before.has(next));
    fresh.forEach((next) => before.set(next, current));
    queue.push(...fresh);
  }
  if (!before.has(to)) return undefined;
  const path = [to];
  while (path[0] !== from) path.unshift(before.get(path[0] as number) as number);
  return path;
}

function roomPool(input: NpcPlanInput, room: RoomSpec, slots: SeatSlot[]): RoomPool {
  const frame = roomFrame(input.spec, room);
  const inRoom = (slot: SeatSlot) =>
    Math.abs(slot.position.x - frame.x) < frame.halfWidth &&
    Math.abs(slot.position.z - frame.z) < frame.halfDepth;
  return {
    spots: input.graph.nodes.flatMap((node, index) =>
      node.room === room.name && node.kind !== "door" ? [index] : [],
    ),
    seats: slots.flatMap((slot, index) => (inRoom(slot) ? [index] : [])),
  };
}

function roomRoles(input: NpcPlanInput, room: RoomSpec, random: Random): string[] {
  const entries = input.preset.roomTypes?.[room.roomType ?? ""]?.npcs ?? [];
  const density = input.spec.npcs?.density ?? 0;
  const roles = entries.flatMap(({ role, density: perRoom }) => {
    const expected = perRoom * density;
    const count = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);
    return Array<string>(count).fill(role);
  });
  return roles.slice(0, npcConfig.maxNpcsPerRoom);
}

function standingRecord(base: NpcRecord, input: NpcPlanInput, spot: number): NpcRecord {
  const node = input.graph.nodes[spot];
  if (node === undefined) return base;
  return { ...base, position: { x: node.x, y: 0, z: node.z } };
}

function walkRecord(base: NpcRecord, input: NpcPlanInput, path: number[]): NpcRecord {
  const route = path.flatMap((index) => {
    const node = input.graph.nodes[index];
    return node === undefined ? [] : [{ x: node.x, z: node.z }];
  });
  return { ...base, behavior: "walk", route };
}

function makeRecord(identity: { id: number; role: string }, definition: Role, random: Random) {
  const record: NpcRecord = {
    id: `npc-${String(identity.id)}`,
    role: identity.role,
    outfitIndex: Math.floor(random() * definition.outfits.length),
    behavior: "idle",
    position: { x: 0, y: 0, z: 0 },
    yaw: round(random() * 360),
    phase: round(random()),
  };
  return record;
}

interface Placement {
  input: NpcPlanInput;
  pool: RoomPool;
  slots: SeatSlot[];
  random: Random;
  total: number;
}

function sitRecord(base: NpcRecord, place: Placement): NpcRecord | undefined {
  const seatId = take(place.pool.seats, place.random);
  const slot = seatId === undefined ? undefined : place.slots[seatId];
  if (slot === undefined) return undefined;
  return { ...base, behavior: "sit", position: slot.position, yaw: slot.yaw, seatId };
}

function placeNpc(place: Placement, base: NpcRecord, wanted: string): NpcRecord | undefined {
  const seated = wanted === "sit" ? sitRecord(base, place) : undefined;
  if (seated !== undefined) return seated;
  const spot = take(place.pool.spots, place.random);
  if (spot === undefined) return undefined;
  const standing = standingRecord(base, place.input, spot);
  const goal = wanted === "walk" ? place.pool.spots.at(-1) : undefined;
  const path = goal === undefined ? undefined : findPath(place.input.graph, spot, goal);
  if (path !== undefined && path.length > 1) return walkRecord(standing, place.input, path);
  return wanted === "chat" ? { ...standing, behavior: "chat" } : standing;
}

function planRoom(place: Placement, room: RoomSpec, roster: NpcRecord[]): void {
  for (const role of roomRoles(place.input, room, place.random)) {
    const definition = place.input.preset.npcRoles?.[role];
    if (definition === undefined || roster.length >= place.total) continue;
    const base = makeRecord({ id: roster.length + 1, role }, definition, place.random);
    const wanted = pickWeighted(Object.entries(definition.behaviors), place.random);
    const walking = roster.filter((npc) => npc.behavior === "walk").length;
    const placed = placeNpc(place, base, walking < maxWalkers ? wanted : "idle");
    if (placed !== undefined) roster.push(placed);
  }
}

export function planNpcs(input: NpcPlanInput): NpcRecord[] {
  const { npcs } = input.spec;
  if (npcs === undefined) return [];
  const random = createSeededRandom(npcs.seed ?? input.spec.seed ?? config.defaultSeed);
  const total = Math.min(npcs.maxTotal ?? Infinity, npcConfig.maxNpcsPerMap);
  const slots = planSeatSlots(input.props);
  const roster: NpcRecord[] = [];
  for (const room of input.spec.rooms) {
    planRoom({ input, pool: roomPool(input, room, slots), slots, random, total }, room, roster);
  }
  return roster;
}
