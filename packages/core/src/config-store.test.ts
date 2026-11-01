import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths, type SkillinkPaths } from '@skillink/shared';
import { readRouteConfig } from './config-store.js';

const tempDirs: string[] = [];

async function tempPaths(): Promise<SkillinkPaths> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skillink-config-'));
  tempDirs.push(dir);
  return getSkillinkPaths(dir);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('config store', () => {
  it('returns an empty route when the file is missing', async () => {
    const paths = await tempPaths();

    await expect(readRouteConfig(paths)).resolves.toEqual({
      schemaVersion: 2,
      targets: [],
    });
  });

  it('rejects invalid route JSON with IO_ERROR', async () => {
    const paths = await tempPaths();
    await writeFile(paths.routeFile, '{', 'utf8');

    await expect(readRouteConfig(paths)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });
  });
});
