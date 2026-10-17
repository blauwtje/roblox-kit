import { config } from "../config.ts";
import type { MapSpec } from "../map/map-spec.ts";
import type { PropRecord } from "../map/prop-placement.ts";
import { rotatedHalfExtents, roomFrame } from "../map/room-frame.ts";
import type { Box } from "../map/room-frame.ts";

const gridSpacingStuds = 6;
const clearanceStuds = 1;

export interface RouteNode {
  kind: "door" | "center" | "grid";
  room: string;
  x: number;
  z: number;
}

export interface RouteGraph {
  nodes: RouteNode[];
  edges: [number, number][];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function footprint(prop: PropRecord): Box {
  const { halfX, halfZ } = rotatedHalfExtents(prop.size, prop.yaw ?? 0);
  return {
    minX: prop.pivot.x - halfX - clearanceStuds,
    maxX: prop.pivot.x + halfX + clearanceStuds,
    minZ: prop.pivot.z - halfZ - clearanceStuds,
    maxZ: prop.pivot.z + halfZ + clearanceStuds,
  };
}

function inside(box: Box, x: number, z: number): boolean {
  return x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ;
}

function slabSpan(start: number, delta: number, [low, high]: [number, number]): [number, number] {
  if (delta === 0) {
    return start > low && start < high ? [0, 1] : [1, 0];
  }
  const first = (low - start) / delta;
  const second = (high - start) / delta;
  return [Math.min(first, second), Math.max(first, second)];
}

function crosses(box: Box, a: RouteNode, b: RouteNode): boolean {
  const spanX = slabSpan(a.x, b.x - a.x, [box.minX, box.maxX]);
  const spanZ = slabSpan(a.z, b.z - a.z, [box.minZ, box.maxZ]);
  const near = Math.max(0, spanX[0], spanZ[0]);
  const far = Math.min(1, spanX[1], spanZ[1]);
  return near < far - 1e-9;
}

function roomNodes(spec: MapSpec, room: MapSpec["rooms"][number], blocked: Box[]): RouteNode[] {
  const frame = roomFrame(spec, room);
  const nodes: RouteNode[] = [];
  const add = (kind: RouteNode["kind"], x: number, z: number) => {
    if (kind !== "door" && blocked.some((box) => inside(box, x, z))) return;
    nodes.push({ kind, room: room.name, x: round(x), z: round(z) });
  };
  for (const door of room.doors) {
    const { side, offset } = door;
    const x = side === "east" ? frame.x + frame.halfWidth : frame.x - frame.halfWidth;
    const z = side === "south" ? frame.z + frame.halfDepth : frame.z - frame.halfDepth;
    const along = side === "north" || side === "south";
    add("door", along ? frame.x + offset : x, along ? z : frame.z + offset);
  }
  add("center", frame.x, frame.z);
  const reachX = frame.halfWidth - clearanceStuds;
  const reachZ = frame.halfDepth - clearanceStuds;
  const columns = Math.max(1, Math.round((2 * reachX) / gridSpacingStuds));
  const rows = Math.max(1, Math.round((2 * reachZ) / gridSpacingStuds));
  for (let column = 0; column <= columns; column++) {
    for (let row = 0; row <= rows; row++) {
      add(
        "grid",
        frame.x - reachX + (2 * reachX * column) / columns,
        frame.z - reachZ + (2 * reachZ * row) / rows,
      );
    }
  }
  return nodes;
}

function linked(pair: [RouteNode, RouteNode], blocked: Box[], wallReach: number): boolean {
  const [a, b] = pair;
  const distance = Math.hypot(a.x - b.x, a.z - b.z);
  if (a.room !== b.room) {
    return a.kind === "door" && b.kind === "door" && distance <= wallReach;
  }
  const near =
    distance <= gridSpacingStuds * 1.5 + 1e-9 || a.kind === "center" || b.kind === "center";
  return near && !blocked.some((box) => crosses(box, a, b));
}

/** Bakes door, room-center and grid nodes per room, joined where the straight line clears every prop footprint, and links doors that face each other across a wall. */
export function bakeRouteGraph(spec: MapSpec, props: readonly PropRecord[]): RouteGraph {
  const blocked = props.map(footprint);
  const nodes = spec.rooms.flatMap((room) => roomNodes(spec, room, blocked));
  const wallReach =
    2 * Math.max(0, ...spec.rooms.map((room) => roomFrame(spec, room).wallThickness)) +
    config.overlapToleranceStuds;
  const edges: [number, number][] = [];
  nodes.forEach((a, i) => {
    nodes.forEach((b, j) => {
      if (j > i && linked([a, b], blocked, wallReach)) edges.push([i, j]);
    });
  });
  return { nodes, edges };
}
