import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { config } from "../config.ts";
import { inlineRequires } from "../luau/inline-requires.ts";
import { propDimensions, propKinds, type PropKind } from "./prop-placement.ts";

type Triple = [number, number, number];

interface PartRecord {
  name: string;
  canCollide: boolean;
  canTouch: boolean;
  canQuery: boolean;
  color: Triple;
  material: string;
  min: Triple;
  max: Triple;
}

interface RunResult {
  kind: PropKind;
  size: Triple;
  seed: number;
  looks: Record<string, { color: Triple; material: string }>;
  parts: PartRecord[];
  texts: string[] | Record<string, never>;
}

const runnerFile = new URL("../../scripts/lune/run-prop-generators.luau", import.meta.url);
const budgetMilliseconds = 1500;
const seeds = [1, 2, 3, 4, 5, 6];
const seedInvariantKinds: readonly PropKind[] = ["sign", "ticket-machine"];
const epsilon = 1e-3;

function nominalSize(kind: PropKind): Triple {
  const dimensions = propDimensions[kind] as { x: number; y?: number; z: number };
  return [dimensions.x, dimensions.y ?? config.defaultWallHeightStuds, dimensions.z];
}

const runs = propKinds.flatMap((kind) => {
  const nominal = nominalSize(kind);
  const sizes: Triple[] = [nominal, [nominal[0] * 1.5, nominal[1] * 1.5, nominal[2] * 1.5]];
  return sizes.flatMap((size) => seeds.map((seed) => ({ kind, size, seed })));
});

function runGenerators(): { results: RunResult[]; milliseconds: number } {
  const directory = mkdtempSync(join(tmpdir(), "prop-generators-"));
  try {
    for (const kind of propKinds) {
      const url = new URL(`../../luau/props/${kind}.luau`, import.meta.url);
      writeFileSync(
        join(directory, `${kind}.luau`),
        inlineRequires(readFileSync(url, "utf8"), url),
      );
    }
    const started = performance.now();
    const output = execFileSync(
      "lune",
      ["run", runnerFile.pathname, JSON.stringify({ directory, runs })],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const milliseconds = performance.now() - started;
    return { results: JSON.parse(output) as RunResult[], milliseconds };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const { results, milliseconds } = runGenerators();

function resultsOf(kind: PropKind): RunResult[] {
  return results.filter((result) => result.kind === kind);
}

function describeRun(result: RunResult): string {
  return `${result.kind} ${result.size.join("x")} seed ${String(result.seed)}`;
}

function isShadeOf(color: Triple, slot: Triple): boolean {
  const ratios = color.map((channel, index) => channel / (slot[index] ?? 1));
  const first = ratios[0] ?? 0;
  return first <= 1 + epsilon && ratios.every((ratio) => Math.abs(ratio - first) < epsilon);
}

function assertInsideSize(result: RunResult, part: PartRecord): void {
  for (const axis of [0, 1, 2]) {
    const half = (result.size[axis] ?? 0) / 2 + epsilon;
    assert.ok(
      (part.min[axis] ?? 0) >= -half && (part.max[axis] ?? 0) <= half,
      `${describeRun(result)} ${part.name} axis ${String(axis)}: ${String(part.min[axis])} to ${String(part.max[axis])} outside +-${String(half)}`,
    );
  }
}

function fingerprint(result: RunResult): string {
  return JSON.stringify({ parts: result.parts, texts: result.texts });
}

await test("every prop kind, size and seed ran in Lune within the time budget", () => {
  assert.equal(results.length, runs.length);
  assert.ok(
    milliseconds < budgetMilliseconds,
    `${milliseconds.toFixed(0)} ms is over ${String(budgetMilliseconds)} ms`,
  );
});

for (const kind of propKinds) {
  await test(`the ${kind} generator builds only decorative parts`, () => {
    for (const result of resultsOf(kind)) {
      assert.ok(result.parts.length > 0, `${describeRun(result)} builds no part`);
      for (const part of result.parts) {
        const flags = [part.canCollide, part.canTouch, part.canQuery];
        assert.deepEqual(flags, [false, false, false], `${describeRun(result)} ${part.name}`);
      }
    }
  });

  await test(`the ${kind} generator keeps every part inside its size about the pivot`, () => {
    for (const result of resultsOf(kind)) {
      for (const part of result.parts) {
        assertInsideSize(result, part);
      }
    }
  });

  await test(`the ${kind} generator takes every part's color and material from its slot attributes`, () => {
    for (const result of resultsOf(kind)) {
      const looks = Object.values(result.looks);
      assert.ok(looks.length > 0, `${describeRun(result)} reads no color attribute`);
      const materials = new Set(looks.map((look) => look.material));
      for (const part of result.parts) {
        assert.ok(
          materials.has(part.material),
          `${describeRun(result)} ${part.name}: ${part.material}`,
        );
        assert.ok(
          looks.some((look) => isShadeOf(part.color, look.color)),
          `${describeRun(result)} ${part.name}: color ${part.color.join(",")} is no slot's`,
        );
      }
    }
  });

  await test(`the ${kind} generator ${seedInvariantKinds.includes(kind) ? "ignores" : "varies with"} the seed`, () => {
    for (const size of new Set(resultsOf(kind).map((result) => result.size.join("x")))) {
      const prints = new Set(
        resultsOf(kind)
          .filter((result) => result.size.join("x") === size)
          .map(fingerprint),
      );
      assert.equal(prints.size > 1, !seedInvariantKinds.includes(kind), `${kind} ${size}`);
    }
  });
}
