import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FakeStudioConnection } from "../../src/studio/fake-studio-connection.ts";
import { withStudio } from "./run-script.ts";

await test("a real script prints its usage for --help and exits 0 without running", () => {
  const result = spawnSync(process.execPath, ["scripts/check-blink-output.ts", "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: node scripts\/check-blink-output\.ts/);
  assert.doesNotMatch(result.stdout, /Blink output matches/);
});

await test("a real script exits 2 and names an unknown option", () => {
  const result = spawnSync(process.execPath, ["scripts/check-blink-output.ts", "--bogus"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--bogus/);
});

const editState = {
  content: [{ type: "text" as const, text: "Current Studio Mode: Edit" }],
};

async function withFakeStudio(
  run: Parameters<typeof withStudio>[1],
  checkViewport: () => Promise<void> = () => Promise.resolve(),
) {
  const lockFile = join(await mkdtemp(join(tmpdir(), "with-studio-")), "studio.lock");
  const events: string[] = [];
  const connection = new FakeStudioConnection([{ id: "s1", name: "Place" }], {
    get_studio_state: () => editState,
  });
  const close = connection.close.bind(connection);
  connection.close = async () => {
    events.push(
      `closed, lock held: ${String(
        await readFile(lockFile).then(
          () => true,
          () => false,
        ),
      )}`,
    );
    await close();
  };
  const result = withStudio(
    { name: "test", lockFile, connect: () => connection, checkViewport },
    async (...args) => {
      events.push(
        `run, lock held: ${String(
          await readFile(lockFile).then(
            () => true,
            () => false,
          ),
        )}`,
      );
      return run(...args);
    },
  );
  return { result, events, lockFile };
}

const lockExists = (lockFile: string) =>
  readFile(lockFile).then(
    () => true,
    () => false,
  );

await test("withStudio runs with the lock and the edit-mode studio id, then closes and releases", async () => {
  const { result, events, lockFile } = await withFakeStudio((_connection, studioId) =>
    Promise.resolve(studioId),
  );
  assert.equal(await result, "s1");
  assert.deepEqual(events, ["run, lock held: true", "closed, lock held: true"]);
  assert.equal(await lockExists(lockFile), false);
});

await test("withStudio closes and releases when the run throws", async () => {
  const { result, events, lockFile } = await withFakeStudio(() =>
    Promise.reject(new Error("boom")),
  );
  await assert.rejects(result, /boom/);
  assert.equal(events.length, 2);
  assert.equal(await lockExists(lockFile), false);
});

await test("withStudio skips the run, closes and releases when the viewport is hidden", async () => {
  let ran = false;
  const { result, events, lockFile } = await withFakeStudio(
    () => {
      ran = true;
      return Promise.resolve();
    },
    () => Promise.reject(new Error("Studio viewport not visible")),
  );
  await assert.rejects(result, /viewport not visible/);
  assert.equal(ran, false);
  assert.deepEqual(events, ["closed, lock held: true"]);
  assert.equal(await lockExists(lockFile), false);
});
