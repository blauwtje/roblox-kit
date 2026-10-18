import { z } from "zod";
import { config } from "../config.ts";
import { lookUpOpenCloudCredentials } from "../hero-props/open-cloud-credentials.ts";
import type { OpenCloudTransport } from "../hero-props/open-cloud-upload.ts";
import { runLuauFile } from "../luau/run-luau-file.ts";
import type { ToolDefinition } from "../server/tool-definition.ts";
import { toolResult } from "../server/tool-result.ts";
import { selectStudio } from "../studio/studio-connection.ts";
import { decodeImage } from "../vision/decode-image.ts";
import { encodePng } from "../vision/encode-png.ts";
import { composeFlipbook } from "./flipbook.ts";
import { uploadCachedImage, type ImageStoreOptions } from "./image-asset-store.ts";
import { planInsert, type InsertEntry } from "./insert-plan.ts";
import { renderSvg } from "./render-svg.ts";
import { createHash } from "node:crypto";

const imageInput = z.strictObject({
  name: z.string().min(1).describe("Instance name and upload name."),
  svg: z
    .string()
    .min(1)
    .optional()
    .describe("SVG source with only the vendored font families. Omit it when frames are given."),
  kind: z
    .enum(["label", "button", "surface", "particle"])
    .describe(
      "label and button go in a ScreenGui, surface on a part face, particle in an emitter.",
    ),
  parent: z
    .string()
    .min(1)
    .describe("Dot path from game, e.g. Workspace.RobloxKitMaps.Map.Sign. Unused by screen kinds."),
  sliceCenter: z
    .strictObject({ x0: z.int(), y0: z.int(), x1: z.int(), y1: z.int() })
    .optional()
    .describe("Nine-slice center in image pixels, for art drawn at twice its display size."),
  flipbook: z
    .strictObject({
      layout: z.enum(["Grid2x2", "Grid4x4", "Grid8x8"]),
      framerate: z.number().optional().describe("Frames per second, at most 30; default 12."),
    })
    .optional()
    .describe("Particle flipbook settings; needs frames."),
  frames: z
    .array(z.string().min(1))
    .optional()
    .describe("One SVG per flipbook frame: 4, 16 or 64 equal squares matching the layout."),
});

const inputSchema = z.strictObject({
  images: z.array(imageInput).min(1).max(16),
  studioId: z.string().min(1).optional().describe("Which Studio; optional while one is connected."),
});

const outputSchema = z.strictObject({
  images: z.array(
    z.strictObject({
      name: z.string(),
      sha256: z.string(),
      assetId: z.string(),
      cached: z.boolean(),
      moderation: z.enum(["approved", "pending"]),
      instancePath: z.string(),
    }),
  ),
  filled: z.int(),
  warnings: z.array(z.string()),
});

const createdSchema = z.strictObject({ created: z.array(z.string()) });

type ImageInput = z.output<typeof imageInput>;

/** Where the tool finds credentials, talks to Open Cloud and records ids; tests replace each. */
export interface InsertImagesDeps extends ImageStoreOptions {
  transport?: OpenCloudTransport;
  lookUpCredentials?: typeof lookUpOpenCloudCredentials;
}

function renderPng(image: ImageInput): Uint8Array<ArrayBuffer> {
  if (image.flipbook) {
    if (!image.frames) throw new Error(`${image.name}: a flipbook needs frames.`);
    const frames = image.frames.map((frame) => decodeImage(renderSvg(frame).png));
    return new Uint8Array(encodePng(composeFlipbook(frames, image.flipbook.layout)));
  }
  if (image.kind === "particle")
    throw new Error(`${image.name}: a particle needs flipbook and frames.`);
  if (image.svg === undefined) throw new Error(`${image.name}: svg is required.`);
  return new Uint8Array(renderSvg(image.svg).png);
}

function toEntry(image: ImageInput, assetId: string, png: Uint8Array): InsertEntry {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return {
    kind: image.kind,
    name: image.name,
    image: `rbxassetid://${assetId}`,
    parent: image.parent,
    width: view.getUint32(16),
    height: view.getUint32(20),
    ...(image.sliceCenter && { slice: image.sliceCenter }),
    ...(image.flipbook && { layout: image.flipbook.layout, framerate: image.flipbook.framerate }),
  };
}

export function createInsertImagesTool(
  deps: InsertImagesDeps = {},
): ToolDefinition<typeof inputSchema, typeof outputSchema> {
  const { transport = {}, lookUpCredentials = lookUpOpenCloudCredentials, ...store } = deps;
  return {
    name: "insert_images",
    title: "Insert rendered images",
    description:
      "Renders SVG to PNG, uploads each as a Roblox Image through Open Cloud (recorded by sha256, so a repeat costs no upload) and inserts it as a ScreenGui label or button, a SurfaceGui image on a part face or a flipbook ParticleEmitter. " +
      "Use it only for buttons, fixed words, fonts and effects the request asks for. Words that change at run time or get translated stay a TextLabel with a built-in FontFace. " +
      "Missing Open Cloud credentials fail before any render. " +
      "Returns { images: [{ name, sha256, assetId, cached, moderation, instancePath }], filled, warnings }; a pending moderation is a warning.",
    inputSchema,
    outputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async handler(input, context) {
      const lookup = await lookUpCredentials();
      if ("missing" in lookup) {
        throw new Error(
          `Open Cloud upload is not set up: ${lookup.missing}. Create an Open Cloud API key with Assets read and write, set ${config.openCloudApiKeyEnv} (or write it to ${config.openCloudKeyFile}), and name the creator with ${config.openCloudCreatorUserIdEnv} or ${config.openCloudCreatorGroupIdEnv}.`,
        );
      }
      const rendered = input.images.map((image) => ({ image, png: renderPng(image) }));
      const studioId = await selectStudio(context.studio, input.studioId);
      let calls = 0;
      const fetchFn = transport.fetchFn ?? fetch;
      const counting: OpenCloudTransport = {
        ...transport,
        fetchFn: (...args) => {
          calls += 1;
          return fetchFn(...args);
        },
      };
      const warnings: string[] = [];
      const entries: InsertEntry[] = [];
      const results = [];
      for (const { image, png } of rendered) {
        const before = calls;
        const uploaded = await uploadCachedImage({
          ...store,
          png,
          name: image.name,
          kind: image.kind,
          credentials: lookup.credentials,
          transport: counting,
        });
        if (uploaded.moderation === "pending") {
          warnings.push(
            `${image.name}: moderation is still pending (asset ${uploaded.assetId}); the image may not show until it is approved.`,
          );
        }
        entries.push(toEntry(image, uploaded.assetId, png));
        results.push({
          name: image.name,
          sha256: createHash("sha256").update(png).digest("hex"),
          assetId: uploaded.assetId,
          cached: calls === before,
          moderation: uploaded.moderation,
        });
      }
      const { created } = await runLuauFile({
        connection: context.studio,
        studioId,
        fileName: "insert-images.luau",
        datamodelType: "Edit",
        arguments: planInsert(entries),
        resultSchema: createdSchema,
      });
      return toolResult({
        images: results.map((result, index) => ({
          ...result,
          instancePath: created[index] ?? "",
        })),
        filled: created.length,
        warnings,
      });
    },
  };
}
