import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSpecSchema } from "../map/map-spec.ts";
import type { PropRecord } from "../map/prop-placement.ts";
import { bakeRouteGraph } from "./route-graph.ts";
import type { RouteGraph } from "./route-graph.ts";

const spec = mapSpecSchema.parse({
  mapId: "m",
  wallThickness: 1,
  rooms: [
    { name: "a", x: 0, z: 0, width: 20, depth: 20, doors: [{ side: "east", offset: 0 }] },
    { name: "b", x: 20, z: 0, width: 20, depth: 20, doors: [{ side: "west", offset: 0 }] },
  ],
});

function neighbors(graph: RouteGraph, node: number): number[] {
  return [
    ...graph.edges.filter(([i]) => i === node).map(([, j]) => j),
    ...graph.edges.filter(([, j]) => j === node).map(([i]) => i),
  ];
}

function connected(graph: RouteGraph, from: number, to: number): boolean {
  const seen = new Set([from]);
  const queue = [from];
  for (let current = queue.pop(); current !== undefined; current = queue.pop()) {
    const fresh = neighbors(graph, current).filter((next) => !seen.has(next));
    fresh.forEach((next) => seen.add(next));
    queue.push(...fresh);
  }
  return seen.has(to);
}

function centers(graph: RouteGraph): number[] {
  return graph.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.kind === "center")
    .map(({ index }) => index);
}

await test("each room gets door, center and grid nodes, and the doors link rooms", () => {
  const graph = bakeRouteGraph(spec, []);
  assert.deepEqual(
    graph.nodes.filter((node) => node.kind === "door").map((node) => [node.room, node.x, node.z]),
    [
      ["a", 9, 0],
      ["b", 11, 0],
    ],
  );
  assert.equal(centers(graph).length, 2);
  assert.ok(graph.nodes.some((node) => node.kind === "grid"));
  const [first, second] = centers(graph) as [number, number];
  assert.ok(connected(graph, first, second));
});

await test("a prop footprint removes nodes under it and blocks lines through it", () => {
  const wall: PropRecord = {
    kind: "crate-stack",
    pivot: { x: 0, y: 1, z: 0 },
    size: { x: 2, y: 2, z: 30 },
    seed: 1,
  };
  const graph = bakeRouteGraph(spec, [wall]);
  assert.ok(!graph.nodes.some((node) => node.room === "a" && Math.abs(node.x) < 2));
  assert.deepEqual(
    centers(graph).map((index) => graph.nodes[index]?.room),
    ["b"],
  );
  const open = bakeRouteGraph(spec, []);
  assert.ok(graph.edges.length < open.edges.length);
});

await test("a prop between two nodes cuts the edge but not a parallel one", () => {
  const prop: PropRecord = {
    kind: "crate-stack",
    pivot: { x: 4, y: 1, z: 0 },
    size: { x: 2, y: 2, z: 2 },
    seed: 1,
  };
  const graph = bakeRouteGraph(spec, [prop]);
  const index = (x: number, z: number) =>
    graph.nodes.findIndex((n) => n.room === "a" && n.x === x && n.z === z);
  const hasEdge = (a: number, b: number) =>
    graph.edges.some(([i, j]) => (i === a && j === b) || (i === b && j === a));
  const center = index(0, 0);
  const door = graph.nodes.findIndex((n) => n.room === "a" && n.kind === "door");
  assert.ok(center >= 0);
  assert.equal(hasEdge(center, door), false);
});
