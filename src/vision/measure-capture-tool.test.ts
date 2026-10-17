import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { createMeasureCaptureTool } from "./measure-capture-tool.ts";

const vector = (x: number, y: number, z: number) => ({ x, y, z });
const zonesText = JSON.stringify({
  zones: [
    { name: "start", min: vector(0, 0, 0), max: vector(40, 12, 40) },
    { name: "vault", min: vector(40, 0, 0), max: vector(60, 12, 40) },
  ],
});
const hit = { distanceStuds: 12.5, material: "Concrete", colorHex: "A0A0A0", instanceKind: "Part" };

function codeOf(request: { arguments: Record<string, unknown> }): string {
  return String(request.arguments["code"]);
}

function studio(onProbe?: (code: string) => void) {
  return new FakeStudioConnection([{ id: "s1", name: "Place" }], {
    execute_luau: (request) => {
      const code = codeOf(request);
      if (code.includes("floorNameSuffix")) {
        return { content: [{ type: "text", text: `[${zonesText}]` }] };
      }
      onProbe?.(code);
      const arguments_ = JSON.parse(/JSONDecode\(\[=*\[(.*)\]=*\]\)/s.exec(code)?.[1] ?? "{}") as {
        columns: number;
        rows: number;
        shots: { zone: string; view: string }[];
      };
      const rows = Array.from({ length: arguments_.rows }, (_, row) =>
        Array.from({ length: arguments_.columns }, (_, column) =>
          row === 0 && column === 0 ? false : hit,
        ),
      );
      const shots = arguments_.shots.map(({ zone, view }) => ({ zone, view, rows }));
      return { content: [{ type: "text", text: JSON.stringify({ aspect: 1.5, shots }) }] };
    },
  });
}

async function run(input: Record<string, unknown>, connection = studio()) {
  const projectDir = await mkdtemp(join(tmpdir(), "measure-capture-"));
  const tool = createMeasureCaptureTool(projectDir);
  const result = await tool.handler(tool.inputSchema.parse({ mapId: "arena", ...input }), {
    studio: connection,
  });
  return { output: tool.outputSchema.parse(result.structuredContent), connection };
}

await test("every zone gets views a and b by default and truth.json holds the cells", async () => {
  const { output } = await run({ grid: { columns: 3, rows: 2 } });
  assert.deepEqual(
    output.shots.map((shot) => `${shot.zone}:${shot.view}`),
    ["start:a", "start:b", "vault:a", "vault:b"],
  );
  assert.deepEqual([output.shots[0]?.missCells, output.shots[0]?.hitCells], [1, 5]);
  const truth = JSON.parse(await readFile(output.truthPath, "utf8")) as {
    aspect: number;
    fieldOfViewDegrees: number;
    shots: { rows: unknown[][] }[];
  };
  assert.equal(truth.aspect, 1.5);
  assert.equal(truth.fieldOfViewDegrees, 70);
  const rows = truth.shots[0]?.rows;
  assert.deepEqual([rows?.[0]?.[0], rows?.[1]?.[2]], [null, hit]);
});

await test("zones and views narrow the shots and the eye view keeps ceilings", async () => {
  const codes: string[] = [];
  const { output } = await run(
    { zones: ["vault"], views: ["eye"] },
    studio((code) => codes.push(code)),
  );
  assert.deepEqual(
    output.shots.map((shot) => `${shot.zone}:${shot.view}`),
    ["vault:eye"],
  );
  assert.equal(output.columns, 8);
  assert.match(codes.join(""), /"hideCeilings":false/);
});

await test("view a ignores the near south wall and an unknown zone is refused", async () => {
  const codes: string[] = [];
  await run(
    { views: ["a"], zones: ["start"] },
    studio((code) => codes.push(code)),
  );
  assert.match(codes.join(""), /start-wall-south-/);
  await assert.rejects(run({ zones: ["nowhere"] }), /no zone named "nowhere"/);
});
