import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { config } from "../config.ts";
import { readHeroAssets, recordHeroAsset } from "./hero-asset-store.ts";
import type { OpenCloudCredentials } from "./open-cloud-credentials.ts";

const glbFileName = "model.glb";
const reviewFileName = "review.json";

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

/**
 * Uploads `glb` as a Model owned by the credentials' user or group, polls the operation until it is done and returns
 * the new asset id. Throws on an HTTP error, a rejected upload or `maxPolls` polls without a result.
 */
export async function uploadGlb(
  glb: Uint8Array<ArrayBuffer>,
  displayName: string,
  credentials: OpenCloudCredentials,
  transport: OpenCloudTransport = {},
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
      assetType: "Model",
      displayName,
      description: displayName,
      creationContext: { creator: credentials.creator },
    }),
  );
  form.append("fileContent", new Blob([glb], { type: "model/gltf-binary" }), glbFileName);
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

const reviewSchema = z.object({ hash: z.string(), passed: z.boolean() });

/**
 * The asset id of the hero prop with recipe hash `hash` whose generated folder is `directory`. An already
 * recorded hash returns its id without a call; otherwise the folder's `review.json` must be a pass for
 * that hash before `model.glb` is uploaded, and the new id is recorded in `hero-assets.json`.
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
  const review = reviewSchema.parse(
    JSON.parse(await readFile(new URL(reviewFileName, directory), "utf8")),
  );
  if (!review.passed || review.hash !== hash) {
    throw new Error(`Refusing to upload ${kind} ${hash}: it has no passed review.`);
  }
  const glb = new Uint8Array(await readFile(new URL(glbFileName, directory)));
  const assetId = await uploadGlb(glb, `${kind}-${hash}`, credentials, transport);
  await recordHeroAsset(hash, { kind, assetId }, assetsFile);
  return assetId;
}
