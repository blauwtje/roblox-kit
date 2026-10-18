import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { composeFlipbook } from "../../src/images/flipbook.ts";
import { readImageAssets } from "../../src/images/image-asset-store.ts";
import { createInsertImagesTool } from "../../src/images/insert-images-tool.ts";
import { renderSvg } from "../../src/images/render-svg.ts";
import { decodeImage } from "../../src/vision/decode-image.ts";
import { encodePng } from "../../src/vision/encode-png.ts";
import { selectStudio, type StudioConnection } from "../../src/studio/studio-connection.ts";
import { callRealTool, executeLuau, expectEqual } from "./shared.ts";

const partName = "RobloxKitSmokeImagesPart";
const partPath = `Workspace.${partName}`;
const sliceCenter = { x0: 32, y0: 32, x1: 64, y1: 64 };
const frameCount = 4;

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function sha256(png: Uint8Array): string {
  return createHash("sha256").update(png).digest("hex");
}

const stateSchema = z.object({
  button: z.object({ image: z.string(), slice: z.string() }).nullable(),
  sign: z.string().nullable(),
  flipbook: z.object({ texture: z.string(), layout: z.string() }).nullable(),
});

const stateLuau = `
local gui = game:GetService("StarterGui"):FindFirstChild("RobloxKitImages")
local button = gui and gui:FindFirstChild("SmokeButton")
local part = workspace:FindFirstChild("${partName}")
local sign = part and part:FindFirstChild("SmokeSign")
local label = sign and sign:FindFirstChildOfClass("ImageLabel")
local emitter = part and part:FindFirstChild("SmokeFlipbook")
local function rect(r) return string.format("%d,%d,%d,%d", r.Min.X, r.Min.Y, r.Max.X, r.Max.Y) end
return game:GetService("HttpService"):JSONEncode({
  button = button and { image = button.Image, slice = rect(button.SliceCenter) } or nil,
  sign = label and label.Image or nil,
  flipbook = emitter and { texture = emitter.Texture, layout = emitter.FlipbookLayout.Name } or nil,
})`;

const cleanupLuau = `
local gui = game:GetService("StarterGui"):FindFirstChild("RobloxKitImages")
local button = gui and gui:FindFirstChild("SmokeButton")
if button then button:Destroy() end
if gui and #gui:GetChildren() == 0 then gui:Destroy() end
local part = workspace:FindFirstChild("${partName}")
if part then part:Destroy() end
return "ok"`;

const createPartLuau = `
local part = Instance.new("Part")
part.Name = "${partName}"
part.Anchored = true
part.Parent = workspace
return "ok"`;

/**
 * Inserts a 9-slice button, a surface sign and a 2x2 flipbook whose PNG hashes are in the kit record, checks
 * each instance, then removes them. A missing hash reports skipped; any upload attempt fails the step.
 */
export async function probeInsertImages(connection: StudioConnection): Promise<string> {
  const [button, sign] = await Promise.all([fixture("button.svg"), fixture("sign.svg")]);
  const frames = await Promise.all(
    Array.from({ length: frameCount }, (_, index) => fixture(`flipbook-${String(index + 1)}.svg`)),
  );
  const flipbookPng = encodePng(
    composeFlipbook(
      frames.map((frame) => decodeImage(renderSvg(frame).png)),
      "Grid2x2",
    ),
  );
  const hashes = [renderSvg(button).png, renderSvg(sign).png, flipbookPng].map(sha256);
  const recorded = await readImageAssets();
  const missing = hashes.filter((hash) => recorded[hash] === undefined);
  if (missing.length > 0) {
    return `skipped: ${String(missing.length)} of 3 fixture hashes are not in the kit record; nothing uploaded`;
  }
  const studioId = await selectStudio(connection, undefined);
  const noUpload = createInsertImagesTool({
    lookUpCredentials: () =>
      Promise.resolve({ credentials: { apiKey: "unused", creator: { userId: "1" } } }),
    transport: {
      fetchFn: () => Promise.reject(new Error("the smoke must not upload")),
    },
  });
  try {
    await executeLuau(connection, studioId, createPartLuau);
    const { output } = await callRealTool(
      noUpload,
      {
        images: [
          { name: "SmokeButton", kind: "button", parent: partPath, svg: button, sliceCenter },
          { name: "SmokeSign", kind: "surface", parent: partPath, svg: sign },
          {
            name: "SmokeFlipbook",
            kind: "particle",
            parent: partPath,
            frames,
            flipbook: { layout: "Grid2x2" },
          },
        ],
      },
      connection,
    );
    expectEqual("images inserted", output.filled, 3);
    expectEqual(
      "all cached",
      output.images.every((image) => image.cached),
      true,
    );
    const state = stateSchema.parse(JSON.parse(await executeLuau(connection, studioId, stateLuau)));
    const id = (index: number) => `rbxassetid://${output.images[index]?.assetId ?? ""}`;
    expectEqual("button image", state.button?.image, id(0));
    expectEqual("button SliceCenter", state.button?.slice, "32,32,64,64");
    expectEqual("sign image", state.sign, id(1));
    expectEqual("flipbook texture", state.flipbook?.texture, id(2));
    expectEqual("FlipbookLayout", state.flipbook?.layout, "Grid2x2");
  } finally {
    await executeLuau(connection, studioId, cleanupLuau);
  }
  const after = stateSchema.parse(JSON.parse(await executeLuau(connection, studioId, stateLuau)));
  expectEqual("images removed", after.button === null && after.sign === null, true);
  return "button, sign and flipbook inserted from recorded hashes and removed";
}
