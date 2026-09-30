import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.ts";
import {
  median,
  qualityAxes,
  reviewRoomQuality,
  type AxisMedians,
  type QualityAxis,
} from "../src/eval/quality-review.ts";
import { readReferenceSet, referenceImagePath } from "../src/eval/reference-set.ts";

const badAnchorsUrl = new URL("../eval/anchors/bad/", import.meta.url);

const badAnchorsPreset = "train-station";
const genericRoomType = "room";

interface CalibrationImage {
  kind: "reference" | "bad-anchor";
  image: string;
  preset: string;
  roomType: string;
  comparisonReferencePaths: string[];
}

interface CalibrationRow {
  kind: CalibrationImage["kind"];
  image: string;
  preset: string;
  medians: AxisMedians | null;
  mean: number | null;
  bound: string;
  inBound: boolean;
  error?: string;
}

interface AxisRow {
  axis: QualityAxis;
  referenceMedian: number;
  badAnchorMedian: number;
  bound: string;
  inBound: boolean;
}

async function calibrationImages(): Promise<CalibrationImage[]> {
  const references = (await readReferenceSet()).map((reference) => ({
    preset: reference.preset,
    path: referenceImagePath(reference),
  }));
  const referencePaths = references.map((reference) => reference.path);
  const images: CalibrationImage[] = references.map((reference) => ({
    kind: "reference",
    image: reference.path,
    preset: reference.preset,
    roomType: genericRoomType,
    comparisonReferencePaths: referencePaths.filter((path) => path !== reference.path),
  }));
  const anchorNames = (await readdir(badAnchorsUrl)).filter((name) => name.endsWith(".jpg")).sort();
  for (const anchorName of anchorNames) {
    images.push({
      kind: "bad-anchor",
      image: fileURLToPath(new URL(anchorName, badAnchorsUrl)),
      preset: badAnchorsPreset,
      roomType: anchorName.slice(0, -".jpg".length),
      comparisonReferencePaths: referencePaths,
    });
  }
  return images;
}

function meanAxisMedian(medians: AxisMedians): number {
  const total = qualityAxes.reduce((sum, axis) => sum + medians[axis], 0);
  return Math.round((total / qualityAxes.length) * 100) / 100;
}

function withinBound(kind: CalibrationImage["kind"], mean: number): boolean {
  return kind === "reference"
    ? mean >= config.calibrationReferenceMeanFloor
    : mean <= config.calibrationBadAnchorMeanCeiling;
}

async function calibrate(image: CalibrationImage): Promise<CalibrationRow> {
  const result = await reviewRoomQuality(
    image.image,
    image.preset,
    image.roomType,
    image.comparisonReferencePaths,
    [image.image],
  );
  const bound =
    image.kind === "reference"
      ? `mean >= ${String(config.calibrationReferenceMeanFloor)}`
      : `mean <= ${String(config.calibrationBadAnchorMeanCeiling)}`;
  const medians = result.medians ?? null;
  const mean = medians === null ? null : meanAxisMedian(medians);
  const row: CalibrationRow = {
    kind: image.kind,
    image: image.image,
    preset: image.preset,
    medians,
    mean,
    bound,
    inBound: mean !== null && withinBound(image.kind, mean),
  };
  if (result.error !== undefined) {
    row.error = result.error;
  }
  return row;
}

function axisRows(rows: CalibrationRow[]): AxisRow[] {
  const scoresOf = (kind: CalibrationRow["kind"], axis: QualityAxis) =>
    rows.flatMap((row) => (row.kind === kind && row.medians !== null ? [row.medians[axis]] : []));
  return qualityAxes.map((axis) => {
    const referenceMedian = median(scoresOf("reference", axis));
    const badAnchorMedian = median(scoresOf("bad-anchor", axis));
    return {
      axis,
      referenceMedian,
      badAnchorMedian,
      bound: `reference - bad >= ${String(config.calibrationAxisGap)}`,
      inBound: referenceMedian - badAnchorMedian >= config.calibrationAxisGap,
    };
  });
}

try {
  const images = await calibrationImages();
  const rows: CalibrationRow[] = [];
  for (const image of images) {
    const row = await calibrate(image);
    console.log(JSON.stringify(row));
    rows.push(row);
  }
  const axes = axisRows(rows);
  for (const axis of axes) {
    console.log(JSON.stringify(axis));
  }
  const imagesIn = rows.filter((row) => row.inBound).length;
  const axesIn = axes.filter((axis) => axis.inBound).length;
  console.log(
    `calibration: ${String(imagesIn)}/${String(rows.length)} images and ${String(axesIn)}/${String(axes.length)} axes inside their bound`,
  );
  if (imagesIn < rows.length || axesIn < axes.length) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
