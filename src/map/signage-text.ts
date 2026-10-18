import { createHash } from "node:crypto";
import { renderSvg } from "../images/render-svg.ts";
import type { ImageAsset } from "../images/image-asset-store.ts";
import { createSeededRandom } from "../shared/seeded-random.ts";
import type { MapSpec } from "./map-spec.ts";
import type { Preset } from "../style/preset-schema.ts";

/** A fixed word of a sign: rendered white, looked up by the hash of its PNG bytes, never uploaded here. */
export interface SignageImage {
  name: string;
  text: string;
  prefix: "Header" | "Screen" | "Label" | "Number";
}

export const departureHeaderImage: SignageImage = {
  name: "departure-board-header",
  text: "DEPARTURES",
  prefix: "Header",
};
export const ticketScreenImage: SignageImage = {
  name: "ticket-machine-screen",
  text: "BUY TICKET",
  prefix: "Screen",
};

const imageHeight = 64;
const charWidth = 40;

/** The white SVG of a fixed word; uploading it under `name` makes `signageAttributes` find it. */
export function signageSvg(text: string): string {
  const width = text.length * charWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(imageHeight)}"><text x="${String(width / 2)}" y="50" font-family="Inter" font-weight="700" font-size="56" text-anchor="middle" fill="#ffffff">${text}</text></svg>`;
}

const hashes = new Map<string, string>();

/** The sha256 of the word's rendered PNG, the key of its record in the image cache. */
export function signageImageHash(image: SignageImage): string {
  let hash = hashes.get(image.text);
  if (hash === undefined) {
    hash = createHash("sha256")
      .update(renderSvg(signageSvg(image.text)).png)
      .digest("hex");
    hashes.set(image.text, hash);
  }
  return hash;
}

function fixedWord(
  image: SignageImage,
  records: Record<string, ImageAsset>,
): { attributes: Record<string, string>; warnings: string[] } {
  const record = records[signageImageHash(image)];
  if (record !== undefined) {
    return {
      attributes: { [`${image.prefix}Image`]: `rbxassetid://${record.assetId}` },
      warnings: [],
    };
  }
  return {
    attributes: { [`${image.prefix}Text`]: image.text },
    warnings: [missWarning(image)],
  };
}

/** The platform numbers the map's rooms name: a room type whose set pieces include a platform edge, by the digits ending its sign label. */
export function platformNumbers(spec: MapSpec, roomTypes: Preset["roomTypes"]): number[] {
  const numbers = new Set<number>();
  for (const room of spec.rooms) {
    const roomType = room.roomType === undefined ? undefined : roomTypes?.[room.roomType];
    const digits = /(\d+)$/.exec(roomType?.signLabel ?? "")?.[1];
    if (roomType?.setPieces.includes("platform-edge") === true && digits !== undefined) {
      numbers.add(Number(digits));
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

const rowCount = 4;
const firstMinute = 8 * 60;
const lastMinute = 20 * 60;

/** Departures in time order, "08:15  CENTRAL     3", naming only the given platforms; the same seed gives the same rows. */
export function departureRows(seed: number, destinations: string[], platforms: number[]): string[] {
  const random = createSeededRandom(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)] as T;
  let minutes = firstMinute + Math.floor(random() * 30);
  return Array.from({ length: Math.min(rowCount, destinations.length) }, (_, index) => {
    minutes = Math.min(minutes + 5 + Math.floor(random() * 35), lastMinute);
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const destination = (destinations[index] ?? "").padEnd(10);
    return `${time}  ${destination} ${String(pick(platforms))}`;
  });
}

const windowMinWidth = 4;

function wordImage(prefix: "Label" | "Number", text: string): SignageImage {
  return {
    name: prefix === "Label" ? `sign-label-${text}` : `ticket-window-${text}`,
    text,
    prefix,
  };
}

function missWarning(image: SignageImage): string {
  return `No cached image for "${image.text}"; the ${image.name} image (white "${image.text}", Inter Bold) is not uploaded, so the sign draws text.`;
}

function labelImage(
  label: string,
  records: Record<string, ImageAsset>,
): { attributes: Record<string, string>; warnings: string[] } {
  const image = wordImage("Label", label);
  const record = label === "" ? undefined : records[signageImageHash(image)];
  if (record !== undefined) {
    return { attributes: { LabelImage: `rbxassetid://${record.assetId}` }, warnings: [] };
  }
  return { attributes: {}, warnings: label === "" ? [] : [missWarning(image)] };
}

function numberImages(
  length: number,
  records: Record<string, ImageAsset>,
): { attributes: Record<string, string>; warnings: string[] } {
  const count = Math.max(1, Math.floor(length / windowMinWidth));
  const images = Array.from({ length: count }, (_, index) =>
    wordImage("Number", String(index + 1)),
  );
  const found = images.map((image) => records[signageImageHash(image)]);
  const warnings = images.filter((_, index) => found[index] === undefined).map(missWarning);
  if (warnings.length > 0) {
    return { attributes: {}, warnings };
  }
  const ids = found.map((record) => `rbxassetid://${record?.assetId ?? ""}`);
  return { attributes: { NumberImages: ids.join(",") }, warnings: [] };
}

/** The piece a sign or counter label belongs to: its generator length and attributes. */
export interface SignagePiece {
  size: { x: number };
  attributes: Record<string, string>;
}

export interface SignageInput {
  spec: MapSpec;
  roomTypes: Preset["roomTypes"];
  destinations: string[];
  records: Record<string, ImageAsset>;
}

/**
 * The generator attributes of a departure board, ticket machine, sign or ticket counter (others get none): the fixed word as an
 * image or text, and for a board `Rows` (newline-joined, flipped at run time) when the map has platforms.
 */
export function signageAttributes(
  kind: string,
  seed: number,
  input: SignageInput,
  piece?: SignagePiece,
): { attributes: Record<string, string>; warnings: string[] } {
  if (kind === "sign" && piece !== undefined) {
    return labelImage(piece.attributes.Label ?? "", input.records);
  }
  if (kind === "ticket-counter" && piece !== undefined) {
    return numberImages(piece.size.x, input.records);
  }
  if (kind === "ticket-machine") {
    return fixedWord(ticketScreenImage, input.records);
  }
  if (kind !== "departure-board") {
    return { attributes: {}, warnings: [] };
  }
  const word = fixedWord(departureHeaderImage, input.records);
  const platforms = platformNumbers(input.spec, input.roomTypes);
  if (platforms.length === 0 || input.destinations.length === 0) {
    return word;
  }
  const rows = departureRows(seed, input.destinations, platforms).join("\n");
  return { attributes: { ...word.attributes, Rows: rows }, warnings: word.warnings };
}
