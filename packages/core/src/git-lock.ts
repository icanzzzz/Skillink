import { mkdir, open, rm, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { SkillinkError, type SkillinkPaths } from '@skillink/shared';
import { isNodeError } from './node-error.js';

export interface HomeLockOptions {
  /** Remove a lock older than this. Defaults to ten minutes. */
  staleMs?: number;
  /** Give up after this long. Defaults to five seconds. */
  timeoutMs?: number;
  /** Delay between attempts. Defaults to 50 ms. */
  retryMs?: number;
}

const DEFAULT_STALE_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_MS = 50;

async function tryAcquire(paths: SkillinkPaths): Promise<boolean> {
  let handle;
  try {
    handle = await open(paths.lockFile, 'wx');
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      return false;
    }

    throw new SkillinkError(
      'IO_ERROR',
      `Failed to create the home lock ${paths.lockFile}.`,
      { lockFile: paths.lockFile },
      { cause: error },
    );
  }

  try {
    await handle.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
      })}\n`,
      'utf8',
    );
  } finally {
    await handle.close();
  }

  return true;
}

async function isStale(paths: SkillinkPaths, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(paths.lockFile);
    return Date.now() - info.mtimeMs > staleMs;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Serialize Skillink writes across processes with a home-level lock file.
 * The lock is always released, including when the task throws.
 */
export async function withHomeLock<T>(
  paths: SkillinkPaths,
  task: () => Promise<T>,
  options: HomeLockOptions = {},
): Promise<T> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const deadline = Date.now() + timeoutMs;

  await mkdir(paths.home, { recursive: true });

  for (;;) {
    if (await tryAcquire(paths)) {
      break;
    }

    if (await isStale(paths, staleMs)) {
      await rm(paths.lockFile, { force: true }).catch(() => undefined);
      continue;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new SkillinkError(
        'LOCK_TIMEOUT',
        `Another Skillink process is holding ${paths.lockFile}.`,
        { lockFile: paths.lockFile, timeoutMs },
      );
    }

    await delay(Math.min(retryMs, remaining));
  }

  try {
    return await task();
  } finally {
    await rm(paths.lockFile, { force: true }).catch(() => undefined);
  }
}
