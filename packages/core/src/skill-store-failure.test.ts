import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSkillDir, getSkillinkPaths } from '@skillink/shared';

const state = vi.hoisted(() => ({
  failWritePath: '',
  failRemovePath: '',
}));

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
    rm: async (target: string, options?: any) => {
      if (state.failRemovePath && target === state.failRemovePath) {
        throw Object.assign(new Error('EBUSY: simulated delete failure'), {
          code: 'EBUSY',
        });
      }
      return actual.rm(target, options);
    },
  };
});

import { importSkill } from './import-skill.js';
import { readSkillFile, removeSkillVersion } from './skill-store.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup() {
  const root = await tempDir('skillink-skill-failure-');
  const home = path.join(root, 'home');
  const source = path.join(root, 'source');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'SKILL.md'), '# demo', 'utf8');
  await writeFile(path.join(source, 'file.txt'), 'content', 'utf8');
  await importSkill({
    sourceDir: source,
    name: 'demo',
    version: '1.0.0',
    home,
  });
  return { home, paths: getSkillinkPaths(home) };
}

afterEach(async () => {
  state.failWritePath = '';
  state.failRemovePath = '';
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('skill-store failure handling', () => {
  it('deletes content before writing skill.json', async () => {
    const { paths } = await setup();
    const contentDir = getSkillDir(paths, 'demo', '1.0.0');
    state.failWritePath = paths.skillFile;

    await expect(
      removeSkillVersion(paths, 'demo', '1.0.0'),
    ).rejects.toThrow(/failed to write/i);
    state.failWritePath = '';

    await expect(
      readFile(path.join(contentDir, 'file.txt'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const skillFile = await readSkillFile(paths);
    expect(skillFile.skills.demo?.versions['1.0.0']).toBeDefined();
  });

  it('keeps the catalog entry when content deletion fails', async () => {
    const { paths } = await setup();
    const contentDir = getSkillDir(paths, 'demo', '1.0.0');
    state.failRemovePath = contentDir;

    await expect(
      removeSkillVersion(paths, 'demo', '1.0.0'),
    ).rejects.toMatchObject({ code: 'IO_ERROR' });
    state.failRemovePath = '';

    const skillFile = await readSkillFile(paths);
    expect(skillFile.skills.demo?.versions['1.0.0']).toBeDefined();
    await expect(
      readFile(path.join(contentDir, 'file.txt'), 'utf8'),
    ).resolves.toBe('content');
  });
});
