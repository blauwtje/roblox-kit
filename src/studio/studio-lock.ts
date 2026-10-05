import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { config } from "../config.ts";

const holderSchema = z.object({ pid: z.number().int().positive(), startedAt: z.number() });
type Holder = z.output<typeof holderSchema>;

export interface StudioLockOptions {
  /** Absolute path of the lock file; its folder is created when missing. */
  lockFile: string;
  staleAfterMs?: number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Receives one line when a stale lock is taken over. */
  log?: (line: string) => void;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
}

/** Signal 0 checks that a process exists without touching it; EPERM means it exists under another user. */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/** Creates the lock file holding `holder` in one step: a hard link fails when the file exists and never shows a half-written file. */
async function tryCreate(lockFile: string, holder: Holder): Promise<boolean> {
  const pendingFile = `${lockFile}.${String(holder.pid)}.pending`;
  await writeFile(pendingFile, JSON.stringify(holder));
  try {
    await link(pendingFile, lockFile);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  } finally {
    await rm(pendingFile, { force: true });
  }
}

/** The lock file's text, or undefined when it vanished since the create attempt. */
async function readLockText(lockFile: string): Promise<string | undefined> {
  try {
    return await readFile(lockFile, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function parseHolder(text: string): Holder | undefined {
  try {
    return holderSchema.parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** Why a well-formed lock is stale, or undefined while its holder may still be using Studio. */
function staleReasonOf(
  holder: Holder,
  {
    isAlive,
    now,
    staleAfterMs,
  }: { isAlive: (pid: number) => boolean; now: number; staleAfterMs: number },
): string | undefined {
  if (!isAlive(holder.pid)) return `process ${String(holder.pid)} is gone`;
  if (now - holder.startedAt > staleAfterMs) return `it is older than ${String(staleAfterMs)} ms`;
  return undefined;
}

/**
 * Removes a stale lock and logs it, but only while the file still holds the stale text: a waiter that takes it over
 * between this read and the rm can still lose its lock, a window of one file read that a rename-based takeover would close.
 */
async function takeOverStale(
  lockFile: string,
  staleText: string,
  reason: string,
  log: (line: string) => void,
): Promise<void> {
  if ((await readLockText(lockFile)) !== staleText) return;
  await rm(lockFile, { force: true });
  log(`Took over the stale Studio lock ${lockFile}: ${reason}.`);
}

/**
 * Waits until this process holds the Studio lock and returns the function that releases it; call that in a
 * `finally`. A lock whose holder process is gone, or that is older than `config.smokeTimeoutMs`, or that is not a
 * holder record is stale: it is taken over with one logged line, so a crashed smoke never blocks the next one.
 * Throws naming the holder when the lock stays held past the wait timeout.
 */
export async function acquireStudioLock(options: StudioLockOptions): Promise<() => Promise<void>> {
  const staleAfterMs = options.staleAfterMs ?? config.smokeTimeoutMs;
  const waitTimeoutMs = options.waitTimeoutMs ?? config.smokeTimeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? config.studioLockPollIntervalMs;
  const log = options.log ?? console.log;
  const now = options.now ?? Date.now;
  const isAlive = options.isAlive ?? processIsAlive;
  const { lockFile } = options;
  await mkdir(dirname(lockFile), { recursive: true });
  const deadline = now() + waitTimeoutMs;
  for (;;) {
    const holder = { pid: process.pid, startedAt: now() };
    if (await tryCreate(lockFile, holder)) {
      return () => releaseStudioLock(lockFile, holder);
    }
    const text = await readLockText(lockFile);
    if (text === undefined) continue;
    const current = parseHolder(text);
    if (current === undefined) {
      await takeOverStale(lockFile, text, "it holds no pid and start time", log);
      continue;
    }
    const staleReason = staleReasonOf(current, { isAlive, now: now(), staleAfterMs });
    if (staleReason !== undefined) {
      await takeOverStale(lockFile, text, staleReason, log);
      continue;
    }
    if (now() >= deadline) {
      throw new Error(
        `The Studio lock ${lockFile} is still held by process ${String(current.pid)}, started ${new Date(current.startedAt).toISOString()}; waited ${String(waitTimeoutMs)} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/** Removes the lock only while it is still this holder's, so a lock taken over as stale is never removed by its old holder. */
async function releaseStudioLock(lockFile: string, holder: Holder): Promise<void> {
  const text = await readLockText(lockFile);
  if (text !== undefined && text === JSON.stringify(holder)) {
    await rm(lockFile, { force: true });
  }
}
