import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSkillinkPaths, type SkillinkPaths } from '@skillink/shared';

const state = vi.hoisted(() => ({ failWritePath: '' }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (state.failWritePath && to === state.failWritePath) {
        throw Object.assign(new Error('EACCES: simulated write failure'), {
          code: 'EACCES',
        });
      }
      return actual.rename(from, to);
    },
  };
});

import { gc } from './gc.js';
import { importFolder } from './import-folder.js';
import { readSkillsFile } from './library.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup(): Promise<SkillinkPaths> {
  const root = await tempDir('skillink-gc-failure-');
  const paths = getSkillinkPaths(path.join(root, 'home'));
  const source = path.join(root, 'source');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'file.txt'), 'content', 'utf8');
  await importFolder({
    sourceDir: source,
    name: 'demo',
    version: '1.0.0',
    home: paths.home,
  });
  return paths;
}

afterEach(async () => {
  state.failWritePath = '';
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('gc failure handling', () => {
  it('moves collected versions back when skills.json cannot be written', async () => {
    const paths = await setup();
    const packageDir = path.join(paths.libraryDir, 'demo', '1.0.0');

    state.failWritePath = paths.skillsFile;
    await expect(
      gc(paths, { dryRun: false, maxAgeDays: 0 }),
    ).rejects.toThrow(/failed to write/i);
    state.failWritePath = '';

    await expect(readFile(path.join(packageDir, 'file.txt'), 'utf8')).resolves.toBe(
      'content',
    );
    const library = await readSkillsFile(paths);
    expect(library.packages.demo?.versions['1.0.0']).toBeDefined();
  });
});
