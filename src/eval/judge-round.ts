import { z } from "zod";
import { config } from "../config.ts";
import { placeMatches, type PlaceAnswer } from "./blind-place-check.ts";
import { codeScoreOf, type CodeScoreInput, type ImageStats } from "./code-score.ts";
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

/** What the deterministic gate reads: a `check_map` result, as `codeScoreOf` takes it, and the statistics of each capture. */
export interface GateInput extends CodeScoreInput {
  /** `check_map`'s `passed`. */
  checkPassed: boolean;
  images: { imageId: string; stats: ImageStats }[];
}

export interface GateResult {
  passed: boolean;
  codeScore: number;
  /** One blocker finding per failed check; empty when the gate passed. */
  findings: RoundFinding[];
}

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
  /** The deterministic gate's input; when the gate fails, the round ends on its findings and reads none of the reviewers' answers above. */
  gate?: GateInput;
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
  /** Set only when the round ran the gate. */
  gate?: { passed: boolean; codeScore: number };
}

/** What one judge round may capture: how many images, each with this long edge in pixels. */
export interface RoundImageBudget {
  images: number;
  longEdge: number;
}

/** The images a round may capture: the early rounds' smaller set from `config`, the full set from round `maxJudgeRounds` on. */
export function roundImageBudget(round: number): RoundImageBudget {
  const early = config.judgeEarlyRounds[round - 1];
  if (round >= config.maxJudgeRounds || early === undefined) {
    return { images: config.maxImagesPerCall, longEdge: config.imageLongEdgeMax };
  }
  return early;
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

function gateFinding(
  type: JudgeFinding["type"],
  cites: string,
  imageId: string,
  visible: string,
  reasoning: string,
): RoundFinding {
  return {
    type,
    severity: "blocker",
    cites,
    evidence: { imageId, visible },
    reasoning,
    verdict: `The deterministic gate failed: ${reasoning}`,
    repeat: false,
  };
}

/** The luminance share of the darkest and of the brightest bin, whichever is larger, with its name. */
function extremeLuminance(histogram: number[]): { share: number; name: string } {
  const dark = histogram[0] ?? 0;
  const bright = histogram[histogram.length - 1] ?? 0;
  return dark >= bright ? { share: dark, name: "dark" } : { share: bright, name: "bright" };
}

/**
 * The deterministic gate that runs before any reviewer: `check_map` must have passed, the code score must reach
 * `config.gateMinCodeScore`, and no capture may be mostly one color, mostly black or white, or without edges.
 * `imageId` of a check_map finding is the first image, since the check is of the whole map.
 */
export function gateOf(input: GateInput): GateResult {
  const findings: RoundFinding[] = [];
  const mapImageId = input.images[0]?.imageId ?? "map";
  if (!input.checkPassed) {
    const issues = Object.entries(input.counts)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${String(count)} ${kind}`);
    findings.push(
      gateFinding(
        "placement",
        "check_map passed",
        mapImageId,
        `check_map reported ${issues.join(", ") || "a failure"}.`,
        "check_map did not pass.",
      ),
    );
  }
  const codeScore = codeScoreOf(input);
  if (codeScore < config.gateMinCodeScore) {
    findings.push(
      gateFinding(
        "placement",
        "code score",
        mapImageId,
        `The code score is ${String(codeScore)}.`,
        `The code score ${String(codeScore)} is below ${String(config.gateMinCodeScore)}.`,
      ),
    );
  }
  for (const { imageId, stats } of input.images) {
    const extreme = extremeLuminance(stats.luminanceHistogram);
    if (stats.flatColorShare > config.gateMaxFlatColorShare) {
      findings.push(
        gateFinding(
          "readability",
          "flat color share",
          imageId,
          `${String(Math.round(stats.flatColorShare * 100))}% of the image is one color.`,
          `The capture is mostly one color (${stats.flatColorShare.toFixed(2)} over ${String(config.gateMaxFlatColorShare)}).`,
        ),
      );
    }
    if (extreme.share > config.gateMaxExtremeLuminanceShare) {
      findings.push(
        gateFinding(
          "lighting",
          "luminance histogram",
          imageId,
          `${String(Math.round(extreme.share * 100))}% of the image is in the ${extreme.name}est luminance bin.`,
          `The capture is almost all ${extreme.name} (${extreme.share.toFixed(2)} over ${String(config.gateMaxExtremeLuminanceShare)}).`,
        ),
      );
    }
    if (stats.edgeDensity < config.gateMinEdgeDensity) {
      findings.push(
        gateFinding(
          "readability",
          "edge density",
          imageId,
          `Edge density is ${stats.edgeDensity.toFixed(4)}.`,
          `The capture has almost no edges (${stats.edgeDensity.toFixed(4)} under ${String(config.gateMinEdgeDensity)}).`,
        ),
      );
    }
  }
  return { passed: findings.length === 0, codeScore, findings };
}

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
 * Judges one round: runs the gate when `input.gate` is set and, when it fails, returns its findings alone with
 * the reviewers' answers unread; otherwise rejects the judge's findings that show nothing, adds the findings of the place checks
 * and of the quality medians, marks repeats against `loggedLines` and decides whether the loop stops.
 * Returns the logged round and the rejected findings.
 */
export function judgeRound(
  input: JudgeRoundInput,
  loggedLines: LoggedRound[],
  date: string,
): { result: RoundResult; rejected: JudgeFinding[] } {
  const { spec } = input;
  const gate = input.gate === undefined ? undefined : gateOf(input.gate);
  const gateFailed = gate !== undefined && !gate.passed;
  const accepted: RoundFinding[] = gateFailed ? [...gate.findings] : [];
  const rejected: JudgeFinding[] = [];
  const reviewed = gateFailed
    ? { ...input, findings: [], placeChecks: [], qualityAnswers: [] }
    : input;
  for (const finding of reviewed.findings) {
    if (finding.evidence.visible === undefined || finding.evidence.visible.trim() === "") {
      rejected.push(finding);
    } else {
      accepted.push({ ...finding, repeat: false });
    }
  }

  const genre = spec.style?.preset;
  for (const check of reviewed.placeChecks) {
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
  for (const review of reviewed.qualityAnswers) {
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
      ...(gate === undefined ? {} : { gate: { passed: gate.passed, codeScore: gate.codeScore } }),
    },
    rejected,
  };
}
