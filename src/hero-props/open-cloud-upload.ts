import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { config } from "../config.ts";
import { checkGlbParts, readGlbParts, type GlbChecks } from "./glb-structure.ts";
import { materialMapNames } from "../style/preset-schema.ts";
import {
  materialMapKind,
  readHeroAssets,
  recordHeroAsset,
  type MaterialMapName,
} from "./hero-asset-store.ts";
import type { OpenCloudCredentials } from "./open-cloud-credentials.ts";

const glbFileName = "model.glb";
/**
 * The checks file beside a generated GLB. It keeps the name and the `hash` and `passed` fields of the
 * render review it replaced, so `hero-prop-asset.ts` and existing generated folders read it unchanged.
 */
export const checksFileName = "review.json";

/** Where a call goes and how it waits; a test injects a fake `fetchFn` and a zero interval. */
export interface OpenCloudTransport {
  fetchFn?: typeof fetch;
  pollIntervalMs?: number;
  maxPolls?: number;
}

const operationSchema = z.object({
  path: z.string().optional(),
  operationId: z.string().optional(),
  done: z.boolean().optional(),
  response: z.object({ assetId: z.string() }).optional(),
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
});

type Operation = z.output<typeof operationSchema>;

async function readOperation(response: Response, action: string): Promise<Operation> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Open Cloud ${action} failed with HTTP ${String(response.status)}: ${body.slice(0, 500)}`,
    );
  }
  return operationSchema.parse(JSON.parse(body));
}

function operationId(operation: Operation): string {
  const id = operation.operationId ?? operation.path?.replace(/^operations\//, "");
  if (id === undefined || id === "") {
    throw new Error("Open Cloud returned an upload operation without an id.");
  }
  return id;
}

function finishedAssetId(operation: Operation): string | undefined {
  if (operation.done !== true) return undefined;
  if (operation.error !== undefined) {
    const { code = "unknown", message = "" } = operation.error;
    throw new Error(`Open Cloud rejected the upload (${code}): ${message}`);
  }
  if (operation.response === undefined) {
    throw new Error("Open Cloud finished the upload without an asset id.");
  }
  return operation.response.assetId;
}

/** One file to upload as an asset of `assetType`, with the MIME type and file name of its multipart part. */
interface AssetFile {
  assetType: "Model" | "Image";
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  fileName: string;
}

/**
 * Uploads `file` owned by the credentials' user or group, polls the operation until it is done and returns
 * the new asset id. Throws on an HTTP error, a rejected upload or `maxPolls` polls without a result.
 */
async function uploadAsset(
  file: AssetFile,
  displayName: string,
  credentials: OpenCloudCredentials,
  transport: OpenCloudTransport,
): Promise<string> {
  const {
    fetchFn = fetch,
    pollIntervalMs = config.openCloudPollIntervalMs,
    maxPolls = config.openCloudMaxPolls,
  } = transport;
  const headers = { "x-api-key": credentials.apiKey };
  const form = new FormData();
  form.append(
    "request",
    JSON.stringify({
      assetType: file.assetType,
      displayName,
      description: displayName,
      creationContext: { creator: credentials.creator },
    }),
  );
  form.append("fileContent", new Blob([file.bytes], { type: file.contentType }), file.fileName);
  const created = await readOperation(
    await fetchFn(config.openCloudAssetsUrl, { method: "POST", headers, body: form }),
    "upload",
  );
  const id = operationId(created);
  let operation = created;
  for (let poll = 0; poll < maxPolls; poll++) {
    const assetId = finishedAssetId(operation);
    if (assetId !== undefined) return assetId;
    await sleep(pollIntervalMs);
    operation = await readOperation(
      await fetchFn(`${config.openCloudOperationsUrl}${encodeURIComponent(id)}`, { headers }),
      "operation poll",
    );
  }
  const assetId = finishedAssetId(operation);
  if (assetId === undefined) {
    throw new Error(
      `Open Cloud upload operation ${id} was not done after ${String(maxPolls)} polls.`,
    );
  }
  return assetId;
}

/** Uploads `glb` as a Model through `uploadAsset` and returns the new asset id. */
export async function uploadGlb(
  glb: Uint8Array<ArrayBuffer>,
  displayName: string,
  credentials: OpenCloudCredentials,
  transport: OpenCloudTransport = {},
): Promise<string> {
  const file = {
    assetType: "Model",
    bytes: glb,
    contentType: "model/gltf-binary",
    fileName: glbFileName,
  } as const;
  return uploadAsset(file, displayName, credentials, transport);
}

/** Uploads `png` as an Image through `uploadAsset` and returns the new asset id. */
export async function uploadImage(
  png: Uint8Array<ArrayBuffer>,
  displayName: string,
  credentials: OpenCloudCredentials,
  transport: OpenCloudTransport = {},
): Promise<string> {
  const file = {
    assetType: "Image",
    bytes: png,
    contentType: "image/png",
    fileName: `${displayName}.png`,
  } as const;
  return uploadAsset(file, displayName, credentials, transport);
}

const checksSchema = z.object({ hash: z.string(), passed: z.boolean() });

/** The checks file's content: the recipe hash and the GLB's deterministic checks. */
export type HeroPropChecks = { hash: string } & GlbChecks;

/**
 * Runs the deterministic checks on the generated `model.glb` in `directory` (floating parts and inverted
 * normals, with `config.heroPropContactToleranceStuds`) and writes them with `hash` as the checks file.
 */
export async function writeHeroPropChecks(directory: URL, hash: string): Promise<HeroPropChecks> {
  const glb = new Uint8Array(await readFile(new URL(glbFileName, directory)));
  const checks = {
    hash,
    ...checkGlbParts(readGlbParts(glb), config.heroPropContactToleranceStuds),
  };
  await writeFile(new URL(checksFileName, directory), JSON.stringify(checks, null, 2));
  return checks;
}

/**
 * The asset id of the hero prop with recipe hash `hash` whose generated folder is `directory`. An already
 * recorded hash returns its id without a call; otherwise the folder's checks file must be a pass for that
 * hash before `model.glb` is uploaded, and the new id is recorded in `hero-assets.json`.
 */
export async function uploadReviewedHeroProp(
  kind: string,
  hash: string,
  directory: URL,
  credentials: OpenCloudCredentials,
  transport: OpenCloudTransport = {},
  assetsFile?: URL,
): Promise<string> {
  const recorded = (await readHeroAssets(assetsFile))[hash];
  if (recorded !== undefined) return recorded.assetId;
  const checks = checksSchema.parse(
    JSON.parse(await readFile(new URL(checksFileName, directory), "utf8")),
  );
  if (!checks.passed || checks.hash !== hash) {
    throw new Error(`Refusing to upload ${kind} ${hash}: it has no passed checks.`);
  }
  const glb = new Uint8Array(await readFile(new URL(glbFileName, directory)));
  const assetId = await uploadGlb(glb, `${kind}-${hash}`, credentials, transport);
  await recordHeroAsset(hash, { kind, assetId }, assetsFile);
  return assetId;
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The Image asset id of each map whose hash is in `hashes`. A map already recorded under its hash keeps its
 * id without a call; every other map's `<map>.png` in `directory` must be a PNG, is uploaded as an Image named
 * `<label>-<map>-<hash>` and recorded under its hash with the kind `materialMapKind(map)`.
 */
export async function uploadMaterialMaps(
  label: string,
  hashes: Record<MaterialMapName, string>,
  directory: URL,
  credentials: OpenCloudCredentials,
  transport: OpenCloudTransport = {},
  assetsFile?: URL,
): Promise<Record<MaterialMapName, string>> {
  const assetIds: Partial<Record<MaterialMapName, string>> = {};
  for (const map of materialMapNames) {
    const hash = hashes[map];
    const kind = materialMapKind(map);
    const recorded = (await readHeroAssets(assetsFile))[hash];
    if (recorded?.kind === kind) {
      assetIds[map] = recorded.assetId;
      continue;
    }
    const png = new Uint8Array(await readFile(new URL(`${map}.png`, directory)));
    if (!pngSignature.every((byte, index) => png[index] === byte)) {
      throw new Error(`Refusing to upload ${label} ${map}: ${map}.png is not a PNG.`);
    }
    const assetId = await uploadImage(png, `${label}-${map}-${hash}`, credentials, transport);
    await recordHeroAsset(hash, { kind, assetId }, assetsFile);
    assetIds[map] = assetId;
  }
  return assetIds as Record<MaterialMapName, string>;
}
