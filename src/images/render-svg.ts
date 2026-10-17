import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { z } from "zod";
import { imagesConfig } from "./images-config.ts";

const fontRowSchema = z.object({
  family: z.string(),
  weight: z.number(),
  file: z.string(),
  sha256: z.string(),
});

export type RenderedSvg = { png: Buffer; width: number; height: number };

const normalizeName = (name: string): string => name.toLowerCase().replace(/[\s-]+/g, "");

const fontRows = z
  .array(fontRowSchema)
  .parse(
    JSON.parse(
      readFileSync(new URL(imagesConfig.fontManifestFile, imagesConfig.fontsFolder), "utf8"),
    ),
  );
const fontFiles = fontRows.map((row) => new URL(row.file, imagesConfig.fontsFolder).pathname);
const familyByName = new Map(fontRows.map((row) => [normalizeName(row.family), row.family]));
const familyNames = [...new Set(fontRows.map((row) => row.family))];

const unquote = (name: string): string =>
  name
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .trim();

function canonicalizeFamilies(svg: string): string {
  const fix = (list: string): string =>
    list
      .split(",")
      .map((entry) => {
        const name = unquote(entry);
        const family = familyByName.get(normalizeName(name));
        if (!family) {
          throw new Error(
            `Unknown font-family "${name}". Valid families: ${familyNames.join(", ")}.`,
          );
        }
        return `'${family}'`;
      })
      .join(", ");
  return svg
    .replace(/font-family="([^"]*)"/g, (_, list: string) => `font-family="${fix(list)}"`)
    .replace(/font-family='([^']*)'/g, (_, list: string) => `font-family="${fix(list)}"`)
    .replace(/font-family:\s*([^;}"]*)/g, (_, list: string) => `font-family:${fix(list)}`);
}

/** Renders SVG text to PNG with only the vendored fonts, so output matches on every machine. */
export function renderSvg(svg: string, options: { scale?: number } = {}): RenderedSvg {
  const scale = options.scale ?? imagesConfig.defaultScale;
  if (!(scale > 0 && scale <= imagesConfig.maxScale)) {
    throw new Error(
      `scale must be above 0 and at most ${String(imagesConfig.maxScale)}, got ${String(scale)}.`,
    );
  }
  const resvg = new Resvg(canonicalizeFamilies(svg), {
    fitTo: { mode: "zoom", value: scale },
    font: {
      loadSystemFonts: false,
      fontFiles,
      defaultFontFamily: imagesConfig.defaultFontFamily,
    },
  });
  const image = resvg.render();
  return { png: image.asPng(), width: image.width, height: image.height };
}
