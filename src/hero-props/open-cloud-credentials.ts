import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.ts";

const repositoryRoot = new URL("../../", import.meta.url);

/** Who owns an uploaded asset, as Open Cloud's `creationContext.creator` takes it: a Roblox user or a group. */
export type OpenCloudCreator = { userId: string } | { groupId: string };

export interface OpenCloudCredentials {
  apiKey: string;
  creator: OpenCloudCreator;
}

/** The credentials, or a sentence naming what is missing to form them; never the key itself. */
export type OpenCloudCredentialsLookup =
  { credentials: OpenCloudCredentials } | { missing: string };

const numericId = z.string().regex(/^\d+$/);
const creatorFileSchema = z.union([
  z.strictObject({ groupId: numericId }),
  z.strictObject({ userId: numericId }),
]);

/** A variable that the MCP config fills with an empty string when unset counts as unset. */
function present(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

async function readOptionalFile(file: URL): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function creatorFromEnv(env: Record<string, string | undefined>): OpenCloudCreator | undefined {
  const userEnv = config.openCloudCreatorUserIdEnv;
  const groupEnv = config.openCloudCreatorGroupIdEnv;
  const userId = present(env[userEnv]);
  const groupId = present(env[groupEnv]);
  if (userId !== undefined && groupId !== undefined) {
    throw new Error(
      `Set only one of ${userEnv} and ${groupEnv}: an uploaded asset has one creator.`,
    );
  }
  if (userId !== undefined) {
    if (!numericId.safeParse(userId).success) {
      throw new Error(`${userEnv} is "${userId}", not a numeric Roblox user id.`);
    }
    return { userId };
  }
  if (groupId !== undefined) {
    if (!numericId.safeParse(groupId).success) {
      throw new Error(`${groupEnv} is "${groupId}", not a numeric Roblox group id.`);
    }
    return { groupId };
  }
  return undefined;
}

async function creatorFromFile(root: URL): Promise<OpenCloudCreator | undefined> {
  const name = config.openCloudCreatorFile;
  const text = await readOptionalFile(new URL(name, root));
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} is not JSON.`, { cause: error });
  }
  const parsed = creatorFileSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${name} must be {"groupId":"<digits>"} or {"userId":"<digits>"}, with the id as a string.`,
    );
  }
  return parsed.data;
}

/**
 * The Open Cloud key and creator. The key comes from its environment variable, else from the trimmed key
 * file under `root`; the creator from the user or group id variable, else from the creator file. A missing
 * key or creator is returned as a sentence naming its variables and file; a malformed creator throws.
 */
export async function lookUpOpenCloudCredentials(
  env: Record<string, string | undefined> = process.env,
  root: URL = repositoryRoot,
): Promise<OpenCloudCredentialsLookup> {
  const apiKey =
    present(env[config.openCloudApiKeyEnv]) ??
    present((await readOptionalFile(new URL(config.openCloudKeyFile, root)))?.trim());
  const creator = creatorFromEnv(env) ?? (await creatorFromFile(root));
  if (apiKey !== undefined && creator !== undefined) return { credentials: { apiKey, creator } };
  const missing: string[] = [];
  if (apiKey === undefined) {
    missing.push(
      `${config.openCloudApiKeyEnv} is not set and ${config.openCloudKeyFile} holds no key`,
    );
  }
  if (creator === undefined) {
    missing.push(
      `no creator: ${config.openCloudCreatorGroupIdEnv} and ${config.openCloudCreatorUserIdEnv} are not set and ${config.openCloudCreatorFile} does not exist (write {"groupId":"<digits>"} or {"userId":"<digits>"} to it)`,
    );
  }
  return { missing: missing.join("; ") };
}
