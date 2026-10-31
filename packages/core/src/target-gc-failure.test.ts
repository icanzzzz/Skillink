import {
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSkillinkPaths, type SkillinkPaths } from '@skillink/shared';

const state = vi.hoisted(() => ({
  failRmPath: '',
  failRenameTo: '',
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: async (
      target: Parameters<typeof actual.rm>[0],
      options?: Parameters<typeof actual.rm>[1],
    ) => {
      if (state.failRmPath && String(target) === state.failRmPath) {
        throw Object.assign(new Error('EIO: simulated delete failure'), {
          code: 'EIO',
        });
      }
      return actual.rm(target, options);
    },
    rename: async (from: string, to: string) => {
      if (state.failRenameTo && to === state.failRenameTo) {
        throw Object.assign(new Error('EIO: simulated write failure'), {
          code: 'EIO',
        });
      }
      return actual.rename(from, to);
    },
  };
});

import { importSkill } from './import-skill.js';
import { createPackageVersion } from './package-store.js';
import { addRouteEntry, readRouteFile } from './route.js';
import { addTarget, removeTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function setup(): Promise<{
  paths: SkillinkPaths;
  targetPath: string;
}> {
  const root = await tempDir('skillink-target-gc-failure-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'target');
  await mkdir(targetPath, { recursive: true });

  const source = await tempDir('skillink-target-gc-failure-source-');
  await writeFile(path.join(source, 'SKILL.md'), '# pdf', 'utf8');
  await importSkill({
    sourceDir: source,
    name: 'pdf',
    version: '1.0.0',
    home,
  });

  const paths = getSkillinkPaths(home);
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.0.0',
    skills: { pdf: '1.0.0' },
  });
  await addTarget({ paths, id: 'project-a', path: targetPath });
  await addRouteEntry({
    paths,
    targetId: 'project-a',
    name: 'frontend',
    requested: '1.0.0',
  });
  return { paths, targetPath };
}

afterEach(async () => {
  state.failRmPath = '';
  state.failRenameTo = '';
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('target GC failure handling', () => {
  it('keeps route unchanged when deleting a resolved skill fails', async () => {
    const { paths, targetPath } = await setup();
    const skillPath = path.join(targetPath, 'pdf');
    await mkdir(skillPath, { recursive: true });
    await writeFile(path.join(skillPath, 'note.txt'), 'copy', 'utf8');
    state.failRmPath = skillPath;

    await expect(
      removeTarget({ paths, id: 'project-a' }),
    ).rejects.toMatchObject({ code: 'IO_ERROR' });

    expect((await readRouteFile(paths)).targets).toHaveLength(1);
    expect(await pathExists(skillPath)).toBe(true);
  });

  it('keeps route unchanged when writing route fails after cleanup', async () => {
    const { paths, targetPath } = await setup();
    const skillPath = path.join(targetPath, 'pdf');
    await mkdir(skillPath, { recursive: true });
    await writeFile(path.join(skillPath, 'note.txt'), 'copy', 'utf8');
    state.failRenameTo = paths.routeFile;

    await expect(
      removeTarget({ paths, id: 'project-a' }),
    ).rejects.toMatchObject({ code: 'IO_ERROR' });

    expect((await readRouteFile(paths)).targets).toHaveLength(1);
    expect(await pathExists(skillPath)).toBe(false);
  });
});
