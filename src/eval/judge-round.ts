import { z } from "zod";
import { config } from "../config.ts";
import { placeMatches, type PlaceAnswer } from "./blind-place-check.ts";
import {
  axisEvidence,
  axisMedians,
  qualityAxes,
  reachesPassScore,
  type AxisEvidence,
  type AxisMedians,
  type QualityAnswer,
  type QualityAxis,
} from "./quality-review.ts";

const findingTypes = [
  "overlap",
  "floating",
  "unreachable",
  "scale",
  "rotation",
  "placement",
  "size-rule",
  "palette",
  "lighting",
  "readability",
  "spec-miss",
] as const;

/**
 * A finding as the `visual-judge` agent returns it (`finding.schema.json`), except that `evidence.visible`
 * may be missing or blank: `judgeRound` rejects such a finding instead of the call failing.
 */
export const judgeFindingSchema = z.strictObject({
  type: z.enum(findingTypes),
  severity: z.enum(["blocker", "major", "minor"]),
  cites: z.string().min(1),
  evidence: z.strictObject({ imageId: z.string().min(1), visible: z.string().optional() }),
  specField: z.string().min(1).optional(),
  reasoning: z.string().min(1),
  verdict: z.string().min(1),
});

export type JudgeFinding = z.output<typeof judgeFindingSchema>;

/** A finding of the round: the judge's own, or one this module made from a place check or a quality score. */
export type RoundFinding = JudgeFinding & {
  /** Whether its `type`, `cites` and `evidence.imageId` appeared in an earlier round of the loop. */
  repeat: boolean;
  placeMatches?: boolean;
  axisMedians?: AxisMedians;
  reachesPassScore?: boolean;
};

export type StopReason = "pass" | "round-limit" | "repeat" | null;

export interface JudgeRoundInput {
  round: number;
  /** The `build_map` spec, as far as the round reads it. */
  spec: {
    mapId: string;
    rooms: { name: string; roomType?: string | undefined }[];
    style?: { preset: string } | undefined;
  };
  zones: string[];
  findings: JudgeFinding[];
  /** The blind place check's answer for each typed room, by zone name. */
  placeChecks: { zone: string; answer: PlaceAnswer }[];
  /** Each room's quality answers, one per reviewer, by zone name. */
  qualityAnswers: { zone: string; answers: QualityAnswer[] }[];
  /** The names a room type accepts besides its own, by room type. */
  acceptedNames: Record<string, string[]>;
}

/** The part of a logged round that repeat detection reads. */
export interface LoggedRound {
  round: number;
  mapId: string;
  findings: { type: string; cites: string; evidence: { imageId: string } }[];
}

export interface RoundScore {
  zone: string;
  medians: AxisMedians;
  evidence: AxisEvidence;
}

/** One line of the judge log, and what `judge_round` answers besides the rejected findings. */
export interface RoundResult {
  round: number;
  date: string;
  mapId: string;
  zones: string[];
  scores: RoundScore[];
  findings: RoundFinding[];
  stopReason: StopReason;
}

/** The finding type each quality axis maps to; the type list has no axis of its own for the last three. */
const axisFindingType: Record<QualityAxis, JudgeFinding["type"]> = {
  palette: "palette",
  lighting: "lighting",
  readability: "readability",
  atmosphere: "lighting",
  focalHierarchy: "readability",
  negativeSpace: "placement",
};

/**
 * The earlier rounds of this loop among the logged lines: the latest `round - 1` lines of `mapId` whose
 * rounds count down from `round - 1` to 1. An older loop's lines stop the walk.
 */
function earlierRounds(lines: LoggedRound[], mapId: string, round: number): LoggedRound[] {
  const sameMap = lines.filter((line) => line.mapId === mapId);
  const latest = sameMap.slice(Math.max(0, sameMap.length - (round - 1)));
  const loop: LoggedRound[] = [];
  let expected = round - 1;
  for (const line of latest.toReversed()) {
    if (line.round !== expected) {
      break;
    }
    loop.push(line);
    expected -= 1;
  }
  return loop;
}

function placeCheckFinding(
  zone: string,
  roomIndex: number,
  genre: string,
  roomType: string,
  answer: PlaceAnswer,
): RoundFinding {
  const field = `rooms[${String(roomIndex)}].roomType`;
  const named = `genre "${answer.genre}", room "${answer.room}", ${answer.furnished}`;
  const wrongPlace = answer.furnished === "furnished";
  return {
    type: "spec-miss",
    severity: "blocker",
    cites: field,
    evidence: { imageId: `${zone}:a`, visible: `A first-time visitor named ${named}.` },
    specField: field,
    reasoning: wrongPlace
      ? `The blind place check should name genre "${genre}" and room type "${roomType}" for ${zone}.`
      : `The blind place check called ${zone} empty, so its set pieces and signs do not carry the room type "${roomType}".`,
    verdict: wrongPlace
      ? `${zone} does not read as a ${roomType} of ${genre}.`
      : `${zone} reads as an empty room, not a ${roomType} of ${genre}.`,
    repeat: false,
    placeMatches: false,
  };
}

function axisFinding(
  zone: string,
  preset: string,
  axis: QualityAxis,
  medians: AxisMedians,
  evidence: AxisEvidence,
): RoundFinding {
  return {
    type: axisFindingType[axis],
    severity: "major",
    cites: `${preset} ${axis}`,
    evidence: { imageId: `${zone}:eye`, visible: evidence[axis].join(" ") },
    reasoning: `The median ${axis} score of ${zone} is ${String(medians[axis])}, below the pass score ${String(config.visualPassScore)}.`,
    verdict: `${zone} falls short on ${axis} against ${preset}.`,
    repeat: false,
    axisMedians: medians,
    reachesPassScore: reachesPassScore(medians),
  };
}

/**
 * Judges one round: rejects the judge's findings that show nothing, adds the findings of the place checks
 * and of the quality medians, marks repeats against `loggedLines` and decides whether the loop stops.
 * Returns the logged round and the rejected findings.
 */
export function judgeRound(
  input: JudgeRoundInput,
  loggedLines: LoggedRound[],
  date: string,
): { result: RoundResult; rejected: JudgeFinding[] } {
  const { spec } = input;
  const accepted: RoundFinding[] = [];
  const rejected: JudgeFinding[] = [];
  for (const finding of input.findings) {
    if (finding.evidence.visible === undefined || finding.evidence.visible.trim() === "") {
      rejected.push(finding);
    } else {
      accepted.push({ ...finding, repeat: false });
    }
  }

  const genre = spec.style?.preset;
  for (const check of input.placeChecks) {
    const roomIndex = spec.rooms.findIndex((room) => room.name === check.zone);
    const roomType = spec.rooms[roomIndex]?.roomType;
    if (genre === undefined || roomType === undefined) {
      throw new Error(
        `Zone ${check.zone} has no room type and style preset to place-check against.`,
      );
    }
    const matches = placeMatches(
      check.answer,
      genre,
      roomType,
      input.acceptedNames[roomType] ?? [],
    );
    if (!matches) {
      accepted.push(placeCheckFinding(check.zone, roomIndex, genre, roomType, check.answer));
    }
  }

  const scores: RoundScore[] = [];
  for (const review of input.qualityAnswers) {
    if (genre === undefined) {
      throw new Error(`Zone ${review.zone} was scored, but the spec sets no style preset to cite.`);
    }
    const medians = axisMedians(review.answers);
    const evidence = axisEvidence(review.answers);
    scores.push({ zone: review.zone, medians, evidence });
    for (const axis of qualityAxes) {
      if (medians[axis] < config.visualPassScore) {
        accepted.push(axisFinding(review.zone, genre, axis, medians, evidence));
      }
    }
  }

  const earlier = earlierRounds(loggedLines, spec.mapId, input.round);
  const seen = new Set(
    earlier.flatMap((line) =>
      line.findings.map(
        (finding) => `${finding.type}|${finding.cites}|${finding.evidence.imageId}`,
      ),
    ),
  );
  const findings = accepted.map((finding) => ({
    ...finding,
    repeat: seen.has(`${finding.type}|${finding.cites}|${finding.evidence.imageId}`),
  }));

  const sentBack = findings.filter((finding) => finding.severity !== "minor");
  let stopReason: StopReason = null;
  if (sentBack.length === 0) {
    stopReason = "pass";
  } else if (input.round >= config.maxJudgeRounds) {
    stopReason = "round-limit";
  } else if (sentBack.some((finding) => finding.repeat)) {
    stopReason = "repeat";
  }

  return {
    result: {
      round: input.round,
      date,
      mapId: spec.mapId,
      zones: input.zones,
      scores,
      findings,
      stopReason,
    },
    rejected,
  };
}
