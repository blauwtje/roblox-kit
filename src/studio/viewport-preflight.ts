import jpeg from "jpeg-js";
import { config } from "../config.ts";
import { selectStudio, type StudioConnection } from "./studio-connection.ts";

/** RGBA pixels, four bytes per pixel, as jpeg-js decodes them. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const viewportNotVisibleMessage = "Studio viewport not visible: bring it to the front and rerun";

function luminanceAt(data: Uint8Array, offset: number): number {
  return (
    0.2126 * (data[offset] ?? 0) +
    0.7152 * (data[offset + 1] ?? 0) +
    0.0722 * (data[offset + 2] ?? 0)
  );
}

/**
 * An image is blank when nearly all its pixels sit within `config.blankCaptureLuminanceTolerance` of the
 * median luminance: a hidden Studio viewport captures as one flat dark color with a few stray pixels.
 */
export function isBlankImage(image: RgbaImage): boolean {
  const pixelCount = image.width * image.height;
  if (pixelCount === 0) return true;
  const luminances = new Float64Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    luminances[pixel] = luminanceAt(image.data, pixel * 4);
  }
  const median = luminances.toSorted()[Math.floor(pixelCount / 2)] ?? 0;
  let uniformPixels = 0;
  for (const luminance of luminances) {
    if (Math.abs(luminance - median) <= config.blankCaptureLuminanceTolerance) uniformPixels++;
  }
  return uniformPixels / pixelCount >= config.blankCaptureUniformShare;
}

/** Takes one screen_capture of the place origin and throws `viewportNotVisibleMessage` when it is blank. */
export async function assertViewportVisible(connection: StudioConnection): Promise<void> {
  const studioId = await selectStudio(connection, undefined);
  const result = await connection.callTool({
    name: "screen_capture",
    studioId,
    arguments: {
      capture_id: "roblox-kit-preflight",
      camera_position: [0, 40, 40],
      look_at_position: [0, 0, 0],
    },
  });
  const image = result.content.find((block) => block.type === "image");
  if (result.isError === true || image === undefined) {
    const detail = result.content.map((block) => (block.type === "text" ? block.text : block.type));
    throw new Error(`The preflight screen_capture returned no image: ${detail.join(" ")}`);
  }
  if (image.mimeType !== "image/jpeg") {
    throw new Error(`The preflight screen_capture returned ${image.mimeType}, not image/jpeg.`);
  }
  const decoded = jpeg.decode(Buffer.from(image.data, "base64"), { useTArray: true });
  if (isBlankImage(decoded)) throw new Error(viewportNotVisibleMessage);
}
