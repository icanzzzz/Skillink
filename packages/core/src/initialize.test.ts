import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths, type SkillinkPaths } from '@skillink/shared';
import { ensureHome } from './initialize.js';

const tempDirs: string[] = [];

async function tempPaths(): Promise<SkillinkPaths> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skillink-initialize-'));
  tempDirs.push(dir);
  return getSkillinkPaths(dir);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('ensureHome', () => {
  it('creates missing control files without rewriting existing files', async () => {
    const paths = await tempPaths();

    await ensureHome(paths);
    const before = await readFile(paths.routeFile, 'utf8');
    await ensureHome(paths);

    expect(await readFile(paths.routeFile, 'utf8')).toBe(before);
  });

  it('refuses a v1 home until init or migrate runs', async () => {
    const paths = await tempPaths();
    await writeFile(paths.skillsFile, '{"schemaVersion":1,"packages":{}}');

    await expect(ensureHome(paths)).rejects.toMatchObject({ code: 'IO_ERROR' });
  });
});
