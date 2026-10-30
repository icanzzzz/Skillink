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
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('skill-store failure handling', () => {
  it('moves content back when skill.json cannot be written during removal', async () => {
    const { paths } = await setup();
    const contentDir = getSkillDir(paths, 'demo', '1.0.0');
    state.failWritePath = paths.skillFile;

    await expect(
      removeSkillVersion(paths, 'demo', '1.0.0'),
    ).rejects.toThrow(/failed to write/i);
    state.failWritePath = '';

    await expect(
      readFile(path.join(contentDir, 'file.txt'), 'utf8'),
    ).resolves.toBe('content');
    const skillFile = await readSkillFile(paths);
    expect(skillFile.skills.demo?.versions['1.0.0']).toBeDefined();
  });
});
