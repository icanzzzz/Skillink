import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import { withHomeLock } from './git-lock.js';

const tempDirs: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skillink-lock-'));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('home lock', () => {
  it('runs the task and releases the lock', async () => {
    const paths = getSkillinkPaths(await tempHome());
    const order: string[] = [];

    const result = await withHomeLock(paths, async () => {
      order.push('task');
      expect(await pathExists(paths.lockFile)).toBe(true);
      const lock = JSON.parse(await readFile(paths.lockFile, 'utf8')) as {
        pid: number;
        startedAt: string;
      };
      expect(lock.pid).toBe(process.pid);
      expect(Date.parse(lock.startedAt)).not.toBeNaN();
      return 'done';
    });

    expect(result).toBe('done');
    expect(order).toEqual(['task']);
    expect(await pathExists(paths.lockFile)).toBe(false);
  });

  it('serializes concurrent writers', async () => {
    const paths = getSkillinkPaths(await tempHome());
    const runs: string[] = [];
    let active = 0;
    let maxActive = 0;

    const task = (name: string) => async () => {
      runs.push(name);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 80));
      active -= 1;
    };

    await Promise.all([
      withHomeLock(paths, task('first'), {
        retryMs: 10,
        timeoutMs: 5000,
      }),
      withHomeLock(paths, task('second'), {
        retryMs: 10,
        timeoutMs: 5000,
      }),
    ]);

    expect(maxActive).toBe(1);
    expect(runs.sort()).toEqual(['first', 'second']);
  });

  it('clears a stale lock', async () => {
    const paths = getSkillinkPaths(await tempHome());
    await writeFile(
      paths.lockFile,
      JSON.stringify({ pid: 999999, startedAt: '2020-01-01T00:00:00.000Z' }),
      'utf8',
    );
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(paths.lockFile, old, old);

    const result = await withHomeLock(paths, async () => 'ran', {
      staleMs: 1000,
      retryMs: 10,
      timeoutMs: 5000,
    });

    expect(result).toBe('ran');
    expect(await pathExists(paths.lockFile)).toBe(false);
  });

  it('times out when another writer holds the lock', async () => {
    const paths = getSkillinkPaths(await tempHome());

    await withHomeLock(paths, async () => {
      await expect(
        withHomeLock(paths, async () => 'never', {
          staleMs: 60_000,
          retryMs: 10,
          timeoutMs: 100,
        }),
      ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });
    });
  });

  it('releases the lock when the task fails', async () => {
    const paths = getSkillinkPaths(await tempHome());

    await expect(
      withHomeLock(paths, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await pathExists(paths.lockFile)).toBe(false);
  });
});
