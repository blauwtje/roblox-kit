import type { RgbaImage } from "./encode-png.ts";
import type { Region } from "./regions.ts";
import { gridCellName } from "./value-structure.ts";

const glyphRows: Record<string, string> = {
  "0": "01110/10001/10011/10101/11001/10001/01110",
  "1": "00100/01100/00100/00100/00100/00100/01110",
  "2": "01110/10001/00001/00010/00100/01000/11111",
  "3": "11110/00001/00001/01110/00001/00001/11110",
  "4": "00010/00110/01010/10010/11111/00010/00010",
  "5": "11111/10000/11110/00001/00001/10001/01110",
  "6": "00110/01000/10000/11110/10001/10001/01110",
  "7": "11111/00001/00010/00100/01000/01000/01000",
  "8": "01110/10001/10001/01110/10001/10001/01110",
  "9": "01110/10001/10001/01111/00001/00010/01100",
  A: "01110/10001/10001/11111/10001/10001/10001",
  B: "11110/10001/10001/11110/10001/10001/11110",
  C: "01110/10001/10000/10000/10000/10001/01110",
  D: "11110/10001/10001/10001/10001/10001/11110",
  E: "11111/10000/10000/11110/10000/10000/11111",
  F: "11111/10000/10000/11110/10000/10000/10000",
  G: "01110/10001/10000/10111/10001/10001/01111",
  H: "10001/10001/10001/11111/10001/10001/10001",
  I: "01110/00100/00100/00100/00100/00100/01110",
  J: "00111/00010/00010/00010/00010/10010/01100",
  K: "10001/10010/10100/11000/10100/10010/10001",
  L: "10000/10000/10000/10000/10000/10000/11111",
  M: "10001/11011/10101/10101/10001/10001/10001",
  N: "10001/10001/11001/10101/10011/10001/10001",
  O: "01110/10001/10001/10001/10001/10001/01110",
  P: "11110/10001/10001/11110/10000/10000/10000",
  Q: "01110/10001/10001/10001/10101/10010/01101",
  R: "11110/10001/10001/11110/10100/10010/10001",
  S: "01111/10000/10000/01110/00001/00001/11110",
  T: "11111/00100/00100/00100/00100/00100/00100",
  U: "10001/10001/10001/10001/10001/10001/01110",
  V: "10001/10001/10001/10001/10001/01010/00100",
  W: "10001/10001/10001/10101/10101/10101/01010",
  X: "10001/10001/01010/00100/01010/10001/10001",
  Y: "10001/10001/01010/00100/00100/00100/00100",
  Z: "11111/00001/00010/00100/01000/10000/11111",
};

type Rgba = [number, number, number, number];

const style = Object.freeze({
  gridLine: [255, 255, 255, 170] as Rgba,
  cellText: [0, 0, 0, 255] as Rgba,
  cellBack: [255, 255, 255, 230] as Rgba,
  regionText: [255, 235, 0, 255] as Rgba,
  regionBack: [0, 0, 0, 230] as Rgba,
  pixelsPerScale: 160,
  glyphWidth: 5,
  glyphHeight: 7,
  padding: 1,
});

function setPixel(canvas: RgbaImage, point: { x: number; y: number }, color: Rgba): void {
  if (point.x < 0 || point.y < 0 || point.x >= canvas.width || point.y >= canvas.height) return;
  canvas.data.set(color, (point.y * canvas.width + point.x) * 4);
}

function fillRect(
  canvas: RgbaImage,
  box: { x: number; y: number; w: number; h: number },
  color: Rgba,
) {
  for (let y = box.y; y < box.y + box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++) setPixel(canvas, { x, y }, color);
}

function textWidth(text: string, scale: number): number {
  return (text.length * (style.glyphWidth + 1) - 1) * scale;
}

function drawGlyph(
  canvas: RgbaImage,
  at: { x: number; y: number; scale: number; color: Rgba },
  glyph: string,
): void {
  const rows = (glyphRows[glyph] ?? "").split("/");
  for (let i = 0; i < style.glyphWidth * style.glyphHeight; i++) {
    const on = rows[Math.floor(i / style.glyphWidth)]?.[i % style.glyphWidth] === "1";
    const cell = {
      x: at.x + (i % style.glyphWidth) * at.scale,
      y: at.y + Math.floor(i / style.glyphWidth) * at.scale,
    };
    if (on) fillRect(canvas, { ...cell, w: at.scale, h: at.scale }, at.color);
  }
}

function drawLabel(
  canvas: RgbaImage,
  label: { text: string; x: number; y: number; scale: number },
  colors: { text: Rgba; back: Rgba },
): void {
  const pad = style.padding * label.scale;
  const width = textWidth(label.text, label.scale) + 2 * pad;
  const height = style.glyphHeight * label.scale + 2 * pad;
  fillRect(canvas, { x: label.x, y: label.y, w: width, h: height }, colors.back);
  label.text.split("").forEach((glyph, index) => {
    const x = label.x + pad + index * (style.glyphWidth + 1) * label.scale;
    drawGlyph(canvas, { x, y: label.y + pad, scale: label.scale, color: colors.text }, glyph);
  });
}

function drawGridLines(canvas: RgbaImage, grid: { columns: number; rows: number }): void {
  for (let c = 1; c < grid.columns; c++)
    fillRect(
      canvas,
      { x: Math.floor((c * canvas.width) / grid.columns), y: 0, w: 1, h: canvas.height },
      style.gridLine,
    );
  for (let r = 1; r < grid.rows; r++)
    fillRect(
      canvas,
      { x: 0, y: Math.floor((r * canvas.height) / grid.rows), w: canvas.width, h: 1 },
      style.gridLine,
    );
}

/**
 * Draws a transparent overlay the size of the image: grid lines, a cell name at each cell's top
 * left and each region's number at the centre of its box.
 */
export function drawGridMarks(
  image: RgbaImage,
  grid: { columns: number; rows: number },
  regions: Region[],
): RgbaImage {
  const canvas: RgbaImage = {
    width: image.width,
    height: image.height,
    data: new Uint8Array(image.width * image.height * 4),
  };
  const scale = Math.max(1, Math.floor(Math.min(image.width, image.height) / style.pixelsPerScale));
  drawGridLines(canvas, grid);
  for (let i = 0; i < grid.columns * grid.rows; i++) {
    const column = i % grid.columns;
    const row = Math.floor(i / grid.columns);
    const x = Math.floor((column * image.width) / grid.columns) + 1;
    const y = Math.floor((row * image.height) / grid.rows) + 1;
    drawLabel(
      canvas,
      { text: gridCellName(column, row), x, y, scale },
      { text: style.cellText, back: style.cellBack },
    );
  }
  for (const region of regions) {
    const text = String(region.id);
    const x = Math.floor((region.boxPx.left + region.boxPx.right - textWidth(text, scale)) / 2);
    const y = Math.floor((region.boxPx.top + region.boxPx.bottom - style.glyphHeight * scale) / 2);
    drawLabel(canvas, { text, x, y, scale }, { text: style.regionText, back: style.regionBack });
  }
  return canvas;
}
