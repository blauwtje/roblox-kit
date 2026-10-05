import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireStudioLock } from "./studio-lock.ts";

async function freshLockFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "studio-lock-")), "nested", "studio.lock");
}

async function readHolder(path: string): Promise<{ pid: number; startedAt: number }> {
  return JSON.parse(await readFile(path, "utf8")) as { pid: number; startedAt: number };
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  );
}

await test("takes a free lock with this pid and removes it on release", async () => {
  const lockFile = await freshLockFile();
  const release = await acquireStudioLock({ lockFile, now: () => 5000 });
  assert.deepEqual(await readHolder(lockFile), {
    pid: process.pid,
    startedAt: 5000,
  });
  await release();
  assert.equal(await exists(lockFile), false);
});

await test("waits on a live holder and times out naming it", async () => {
  const lockFile = await freshLockFile();
  const release = await acquireStudioLock({ lockFile });
  await assert.rejects(
    acquireStudioLock({ lockFile, waitTimeoutMs: 20, pollIntervalMs: 5 }),
    new RegExp(`still held by process ${String(process.pid)}`),
  );
  await release();
});

await test("takes over a lock whose holder process is gone and logs it", async () => {
  const lockFile = await freshLockFile();
  const crashed = await acquireStudioLock({ lockFile });
  await writeFile(lockFile, JSON.stringify({ pid: 424242, startedAt: Date.now() }));
  const lines: string[] = [];
  const release = await acquireStudioLock({
    lockFile,
    waitTimeoutMs: 0,
    isAlive: (pid) => pid !== 424242,
    log: (line) => lines.push(line),
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /stale Studio lock .*process 424242 is gone/);
  assert.equal((await readHolder(lockFile)).pid, process.pid);
  await crashed();
  assert.equal(await exists(lockFile), true, "the old holder's release leaves the new lock");
  await release();
});

await test("takes over a live holder's lock older than the smoke timeout", async () => {
  const lockFile = await freshLockFile();
  await acquireStudioLock({ lockFile, now: () => 1000 });
  const lines: string[] = [];
  const release = await acquireStudioLock({
    lockFile,
    staleAfterMs: 500,
    waitTimeoutMs: 0,
    now: () => 2000,
    log: (line) => lines.push(line),
  });
  assert.match(lines[0] ?? "", /older than 500 ms/);
  assert.equal((await readHolder(lockFile)).startedAt, 2000);
  await release();
});

await test("takes over a lock file that holds no holder record", async () => {
  const lockFile = await freshLockFile();
  await acquireStudioLock({ lockFile });
  await writeFile(lockFile, "not json");
  const lines: string[] = [];
  const release = await acquireStudioLock({
    lockFile,
    waitTimeoutMs: 0,
    log: (line) => lines.push(line),
  });
  assert.match(lines[0] ?? "", /holds no pid and start time/);
  await release();
});
