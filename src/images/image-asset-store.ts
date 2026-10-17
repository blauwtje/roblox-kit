import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { OpenCloudCredentials } from "../hero-props/open-cloud-credentials.ts";
import {
  isPng,
  readModeration,
  uploadImage,
  type OpenCloudTransport,
} from "../hero-props/open-cloud-upload.ts";
import { imageStoreConfig } from "./images-config.ts";

const approved = "MODERATION_STATE_APPROVED";
const rejected = "MODERATION_STATE_REJECTED";

const imageAssetSchema = z.strictObject({
  name: z.string().min(1),
  kind: z.string().min(1),
  assetId: z.string().regex(/^\d+$/),
});
const imageAssetsSchema = z.record(z.string(), imageAssetSchema);

export type ImageAsset = z.output<typeof imageAssetSchema>;

/** Where recorded ids are read and written, and how long a moderation wait lasts. */
export interface ImageStoreOptions {
  assetsFile?: URL;
  projectDir?: string;
  moderationPollIntervalMs?: number;
  moderationMaxPolls?: number;
}

/** What `uploadCachedImage` takes: the image, its Open Cloud access and the store options. */
export interface UploadRequest extends ImageStoreOptions {
  png: Uint8Array<ArrayBuffer>;
  name: string;
  kind: string;
  credentials: OpenCloudCredentials;
  transport?: OpenCloudTransport;
}

/** The result of `uploadCachedImage`: `moderation` is `"pending"` when the wait ran out, else `"approved"`. */
export interface CachedImage {
  assetId: string;
  moderation: "approved" | "pending";
}

/** Every recorded image by sha256 of its bytes; a missing file is an empty record. */
export async function readImageAssets(
  file: URL = imageStoreConfig.kitAssetsFile,
): Promise<Record<string, ImageAsset>> {
  try {
    return imageAssetsSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function recordImageAsset(hash: string, asset: ImageAsset, file: URL): Promise<void> {
  const updated = { ...(await readImageAssets(file)), [hash]: imageAssetSchema.parse(asset) };
  await mkdir(new URL(".", file), { recursive: true });
  const pending = new URL(`${file.href}.tmp`);
  await writeFile(pending, `${JSON.stringify(updated, null, 2)}\n`);
  await rename(pending, file);
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (png.byteLength < 24 || view.getUint32(12) !== 0x49484452) {
    throw new Error("The PNG has no IHDR chunk.");
  }
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function userFile(projectDir: string): URL {
  return new URL(
    imageStoreConfig.userAssetsPath,
    new URL(`file://${projectDir.replace(/\/?$/, "/")}`),
  );
}

/**
 * The Image asset id for `png`. A recorded sha256 of the bytes returns its id with no call. Otherwise the
 * bytes must be a PNG of 1 to `maxImageSide` pixels per side, are uploaded as `name`, and are
 * polled until moderation is approved, which is the only state recorded. A rejected image throws; one still
 * pending after the polls returns `{ assetId, moderation: "pending" }` unrecorded.
 */
export async function uploadCachedImage(request: UploadRequest): Promise<CachedImage> {
  const { png, name, kind, credentials, transport = {}, ...options } = request;
  const hash = createHash("sha256").update(png).digest("hex");
  const writeFileUrl =
    options.projectDir === undefined
      ? (options.assetsFile ?? imageStoreConfig.kitAssetsFile)
      : userFile(options.projectDir);
  const readFiles = [options.assetsFile ?? imageStoreConfig.kitAssetsFile, writeFileUrl];
  for (const file of readFiles) {
    const recorded = (await readImageAssets(file))[hash];
    if (recorded !== undefined) return { assetId: recorded.assetId, moderation: "approved" };
  }
  if (!isPng(png)) throw new Error(`Refusing to upload ${name}: the bytes are not a PNG.`);
  const { width, height } = pngSize(png);
  const side = imageStoreConfig.maxImageSide;
  if (width < 1 || height < 1 || width > side || height > side) {
    throw new Error(
      `Refusing to upload ${name}: ${String(width)}x${String(height)} is outside 1-${String(side)}.`,
    );
  }
  const assetId = await uploadImage(png, name, credentials, transport);
  const {
    moderationPollIntervalMs = imageStoreConfig.moderationPollIntervalMs,
    moderationMaxPolls = imageStoreConfig.moderationMaxPolls,
  } = options;
  for (let poll = 0; poll < moderationMaxPolls; poll++) {
    const state = await readModeration(assetId, credentials, transport);
    if (state === approved) {
      await recordImageAsset(hash, { name, kind, assetId }, writeFileUrl);
      return { assetId, moderation: "approved" };
    }
    if (state === rejected)
      throw new Error(`Roblox moderation rejected ${name} (asset ${assetId}).`);
    await sleep(moderationPollIntervalMs);
  }
  return { assetId, moderation: "pending" };
}
