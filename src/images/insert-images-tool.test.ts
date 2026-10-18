import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { FakeStudioConnection } from "../studio/fake-studio-connection.ts";
import { createInsertImagesTool } from "./insert-images-tool.ts";

const credentials = { apiKey: "k", creator: { userId: "42" } };
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#c33"/><text x="4" y="22" font-family="Inter" font-size="16" fill="#fff">Play</text></svg>';
const button = { name: "PlayButton", svg, kind: "button" as const, parent: "StarterGui" };

function setup(missing?: string) {
  const urls: string[] = [];
  const fetchFn: typeof fetch = (input) => {
    const url = new Request(input).url;
    urls.push(url);
    const moderation = Response.json({
      moderationResult: { moderationState: "MODERATION_STATE_APPROVED" },
    });
    const uploaded = Response.json({ operationId: "op", done: true, response: { assetId: "555" } });
    return Promise.resolve(url.endsWith("/assets") ? uploaded : moderation);
  };
  const studio = new FakeStudioConnection([{ id: "s1", name: "Place" }], {
    execute_luau: () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ created: ["StarterGui.RobloxKitImages.PlayButton"] }),
        },
      ],
    }),
  });
  return { urls, fetchFn, studio, missing };
}

async function toolWith(env: ReturnType<typeof setup>, missing?: string) {
  const dir = await mkdtemp(join(tmpdir(), "images-"));
  return createInsertImagesTool({
    transport: { fetchFn: env.fetchFn },
    assetsFile: pathToFileURL(join(dir, "kit.json")),
    projectDir: dir,
    moderationPollIntervalMs: 0,
    moderationMaxPolls: 3,
    lookUpCredentials: () => Promise.resolve(missing ? { missing } : { credentials }),
  });
}

await test("missing credentials fail before any render, upload or Studio call", async () => {
  const env = setup();
  const tool = await toolWith(env, "no key");
  await assert.rejects(
    tool.handler({ images: [{ ...button, svg: "<not svg" }] }, { studio: env.studio }),
    /not set up: no key/,
  );
  assert.equal(env.urls.length, 0);
  assert.equal(env.studio.requests.length, 0);
});

await test("the description limits use to asked-for images and keeps run-time words as TextLabel", async () => {
  const { description } = await toolWith(setup());
  assert.match(description, /only for buttons, fixed words, fonts and effects/);
  assert.match(description, /TextLabel with a built-in FontFace/);
});

await test("uploads once, inserts, and reports a repeat as cached", async () => {
  const env = setup();
  const tool = await toolWith(env);
  const first = await tool.handler({ images: [button] }, { studio: env.studio });
  const output = first.structuredContent as { images: Record<string, unknown>[]; filled: number };
  assert.equal(output.filled, 1);
  assert.equal(output.images[0]?.["assetId"], "555");
  assert.equal(output.images[0]["cached"], false);
  assert.equal(output.images[0]["instancePath"], "StarterGui.RobloxKitImages.PlayButton");
  const calls = env.urls.length;
  const second = await tool.handler({ images: [button] }, { studio: env.studio });
  const again = second.structuredContent as { images: Record<string, unknown>[] };
  assert.equal(again.images[0]?.["cached"], true);
  assert.equal(env.urls.length, calls);
});

await test("a flipbook without frames is rejected", async () => {
  const env = setup();
  const tool = await toolWith(env);
  await assert.rejects(
    tool.handler(
      { images: [{ ...button, kind: "particle", flipbook: { layout: "Grid2x2" } }] },
      { studio: env.studio },
    ),
    /needs frames/,
  );
});
