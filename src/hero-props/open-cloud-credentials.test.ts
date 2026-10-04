import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { lookUpOpenCloudCredentials } from "./open-cloud-credentials.ts";

/** A temporary project root, with `.roblox-kit/open-cloud-key` and `open-cloud-creator.json` written when given. */
async function projectRoot(files: { key?: string; creator?: string } = {}): Promise<URL> {
  const root = await mkdtemp(join(tmpdir(), "open-cloud-credentials-"));
  await mkdir(join(root, ".roblox-kit"));
  if (files.key !== undefined)
    await writeFile(join(root, ".roblox-kit", "open-cloud-key"), files.key);
  if (files.creator !== undefined) {
    await writeFile(join(root, ".roblox-kit", "open-cloud-creator.json"), files.creator);
  }
  return pathToFileURL(`${root}/`);
}

await test("the key and creator come from the environment first, as a user or a group", async () => {
  const root = await projectRoot({ key: "file-key", creator: '{"groupId":"1"}' });
  assert.deepEqual(
    await lookUpOpenCloudCredentials(
      { ROBLOX_OPEN_CLOUD_API_KEY: "k", ROBLOX_CREATOR_USER_ID: "7" },
      root,
    ),
    { credentials: { apiKey: "k", creator: { userId: "7" } } },
  );
  assert.deepEqual(
    await lookUpOpenCloudCredentials(
      { ROBLOX_OPEN_CLOUD_API_KEY: "k", ROBLOX_CREATOR_GROUP_ID: "718128661" },
      root,
    ),
    { credentials: { apiKey: "k", creator: { groupId: "718128661" } } },
  );
});

await test("unset or empty variables fall back to the trimmed key file and the creator file", async () => {
  const root = await projectRoot({ key: "  file-key\n", creator: '{"groupId":"718128661"}' });
  assert.deepEqual(
    await lookUpOpenCloudCredentials(
      { ROBLOX_OPEN_CLOUD_API_KEY: "", ROBLOX_CREATOR_USER_ID: "", ROBLOX_CREATOR_GROUP_ID: "" },
      root,
    ),
    { credentials: { apiKey: "file-key", creator: { groupId: "718128661" } } },
  );
  const userRoot = await projectRoot({ key: "file-key", creator: '{"userId":"42"}' });
  assert.deepEqual(await lookUpOpenCloudCredentials({}, userRoot), {
    credentials: { apiKey: "file-key", creator: { userId: "42" } },
  });
});

await test("a missing key or creator is named with its variable and file", async () => {
  const lookup = await lookUpOpenCloudCredentials({}, await projectRoot({ key: " \n" }));
  assert.ok("missing" in lookup);
  assert.match(lookup.missing, /ROBLOX_OPEN_CLOUD_API_KEY is not set/);
  assert.match(lookup.missing, /\.roblox-kit\/open-cloud-key/);
  assert.match(lookup.missing, /ROBLOX_CREATOR_GROUP_ID/);
  assert.match(lookup.missing, /ROBLOX_CREATOR_USER_ID/);
  assert.match(lookup.missing, /\.roblox-kit\/open-cloud-creator\.json/);

  const keyOnly = await lookUpOpenCloudCredentials(
    { ROBLOX_OPEN_CLOUD_API_KEY: "secret-key" },
    await projectRoot(),
  );
  assert.ok("missing" in keyOnly);
  assert.doesNotMatch(keyOnly.missing, /ROBLOX_OPEN_CLOUD_API_KEY is not set/);
  assert.doesNotMatch(keyOnly.missing, /secret-key/);
  assert.match(keyOnly.missing, /open-cloud-creator\.json/);
});

await test("a malformed creator is refused, naming its variable or file", async () => {
  const root = await projectRoot();
  await assert.rejects(
    lookUpOpenCloudCredentials(
      { ROBLOX_OPEN_CLOUD_API_KEY: "k", ROBLOX_CREATOR_USER_ID: "me" },
      root,
    ),
    /ROBLOX_CREATOR_USER_ID/,
  );
  await assert.rejects(
    lookUpOpenCloudCredentials(
      { ROBLOX_OPEN_CLOUD_API_KEY: "k", ROBLOX_CREATOR_USER_ID: "7", ROBLOX_CREATOR_GROUP_ID: "8" },
      root,
    ),
    /only one of/,
  );
  for (const creator of ['{"groupId":718128661}', '{"teamId":"1"}', "not json"]) {
    await assert.rejects(
      lookUpOpenCloudCredentials(
        { ROBLOX_OPEN_CLOUD_API_KEY: "secret-key" },
        await projectRoot({ creator }),
      ),
      (error: Error) =>
        error.message.includes("open-cloud-creator.json") && !error.message.includes("secret-key"),
    );
  }
});
