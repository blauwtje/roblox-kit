import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { config } from "../config.ts";
import {
  judgeFindingSchema,
  judgeRound,
  type JudgeFinding,
  type JudgeRoundInput,
  type LoggedRound,
} from "./judge-round.ts";

await test("the finding types are the ones skills/visual-judge/finding.schema.json lists", () => {
  const text = readFileSync(
    new URL("../../skills/visual-judge/finding.schema.json", import.meta.url),
    "utf8",
  );
  const agentSchema = JSON.parse(text) as { properties: { type: { enum: string[] } } };
  assert.deepEqual(
    [...judgeFindingSchema.shape.type.options].sort(),
    [...agentSchema.properties.type.enum].sort(),
  );
});

const date = "2026-01-01T00:00:00.000Z";

function answer(score: number) {
  const axis = { evidence: `seen at ${String(score)}`, score };
  return {
    palette: axis,
    focalHierarchy: axis,
    negativeSpace: axis,
    readability: axis,
    atmosphere: axis,
    lighting: axis,
  };
}

function inputOf(overrides: Partial<JudgeRoundInput> = {}): JudgeRoundInput {
  return {
    round: 1,
    spec: {
      mapId: "station",
      rooms: [{ name: "hall", roomType: "ticket-hall" }, { name: "yard" }],
      style: { preset: "train-station" },
    },
    zones: ["hall"],
    findings: [],
    placeChecks: [],
    qualityAnswers: [],
    acceptedNames: {},
    ...overrides,
  };
}

function finding(overrides: Partial<JudgeFinding> = {}): JudgeFinding {
  return {
    type: "palette",
    severity: "major",
    cites: "train-station palette",
    evidence: { imageId: "hall:a", visible: "grey walls" },
    reasoning: "r",
    verdict: "v",
    ...overrides,
  };
}

function logged(round: number, mapId = "station", imageId = "hall:a"): LoggedRound {
  return {
    round,
    mapId,
    findings: [{ type: "palette", cites: "train-station palette", evidence: { imageId } }],
  };
}

await test("a finding without evidence.visible is rejected, not judged", () => {
  const blank = finding({ evidence: { imageId: "hall:a", visible: "  " } });
  const missing = finding({ evidence: { imageId: "hall:a" } });
  const { result, rejected } = judgeRound(
    inputOf({ findings: [blank, finding({ severity: "minor" }), missing] }),
    [],
    date,
  );
  assert.deepEqual(rejected, [blank, missing]);
  assert.equal(result.findings.length, 1);
});

await test("a place-check mismatch and an empty answer become spec-miss blockers; a match adds none", () => {
  const furnished = { clues: "", genre: "airport", room: "Gate", furnished: "furnished" } as const;
  const empty = {
    clues: "",
    genre: "train-station",
    room: "Ticket Hall",
    furnished: "empty",
  } as const;
  const match = {
    clues: "",
    genre: "train-station",
    room: "Ticket Hall",
    furnished: "furnished",
  } as const;
  const { result } = judgeRound(
    inputOf({
      placeChecks: [
        { zone: "hall", answer: furnished },
        { zone: "hall", answer: empty },
        { zone: "hall", answer: match },
      ],
    }),
    [],
    date,
  );
  assert.equal(result.findings.length, 2);
  for (const found of result.findings) {
    assert.equal(found.type, "spec-miss");
    assert.equal(found.severity, "blocker");
    assert.equal(found.placeMatches, false);
    assert.equal(found.cites, "rooms[0].roomType");
  }
});

await test("an accepted room name matches the place check", () => {
  const answerNamed = {
    clues: "",
    genre: "train-station",
    room: "Booking Office",
    furnished: "furnished",
  } as const;
  const { result } = judgeRound(
    inputOf({
      placeChecks: [{ zone: "hall", answer: answerNamed }],
      acceptedNames: { "ticket-hall": ["booking office"] },
    }),
    [],
    date,
  );
  assert.deepEqual(result.findings, []);
});

await test("each axis median below the pass score is one major finding citing the preset and axis on the eye image", () => {
  const weak = answer(config.visualPassScore - 3);
  const strong = answer(config.visualPassScore + 1);
  const mixed = { ...strong, lighting: weak.lighting };
  const { result } = judgeRound(
    inputOf({ qualityAnswers: [{ zone: "hall", answers: [mixed, mixed, strong] }] }),
    [],
    date,
  );
  assert.equal(result.findings.length, 1);
  const found = result.findings[0];
  assert.ok(found !== undefined);
  assert.equal(found.severity, "major");
  assert.equal(found.cites, "train-station lighting");
  assert.equal(found.evidence.imageId, "hall:eye");
  assert.equal(found.axisMedians?.lighting, config.visualPassScore - 3);
  assert.equal(found.reachesPassScore, false);
  assert.equal(result.scores[0]?.zone, "hall");
});

await test("a finding is a repeat when type, cites and imageId appeared in an earlier round of the loop", () => {
  const input = inputOf({
    round: 2,
    findings: [finding(), finding({ evidence: { imageId: "hall:b", visible: "x" } })],
  });
  const { result } = judgeRound(input, [logged(1)], date);
  assert.deepEqual(
    result.findings.map((found) => found.repeat),
    [true, false],
  );
  assert.equal(result.stopReason, "repeat");
});

await test("only the latest round - 1 lines of the same map that count down to 1 are earlier rounds", () => {
  const input = inputOf({ round: 2, findings: [finding()] });
  assert.equal(judgeRound(input, [logged(1, "other")], date).result.findings[0]?.repeat, false);
  const oldLoop = [logged(1), logged(2), logged(3)];
  assert.equal(judgeRound(input, oldLoop, date).result.findings[0]?.repeat, false);
  const third = inputOf({ round: 3, findings: [finding()] });
  assert.equal(
    judgeRound(third, [logged(1), logged(2, "station", "x")], date).result.findings[0]?.repeat,
    true,
  );
  assert.equal(
    judgeRound(third, [logged(7), logged(2, "station", "x")], date).result.findings[0]?.repeat,
    false,
  );
});

await test("stopReason is pass before round-limit before repeat, else null", () => {
  assert.equal(judgeRound(inputOf(), [], date).result.stopReason, "pass");
  assert.equal(
    judgeRound(inputOf({ findings: [finding({ severity: "minor" })] }), [], date).result.stopReason,
    "pass",
  );
  assert.equal(
    judgeRound(inputOf({ round: config.maxJudgeRounds + 1 }), [], date).result.stopReason,
    "pass",
  );
  const limit = inputOf({ round: config.maxJudgeRounds, findings: [finding()] });
  assert.equal(judgeRound(limit, [logged(1), logged(2)], date).result.stopReason, "round-limit");
  assert.equal(judgeRound(inputOf({ findings: [finding()] }), [], date).result.stopReason, null);
});
