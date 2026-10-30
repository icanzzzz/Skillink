import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
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

import { migrateV1ToV2 } from './migrate.js';

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

async function setup() {
  const root = await tempDir('skillink-migrate-failure-');
  const paths = getSkillinkPaths(path.join(root, 'home'));
  await mkdir(paths.home, { recursive: true });
  const contentDir = getSkillDir(paths, 'demo', '1.0.0');
  await mkdir(contentDir, { recursive: true });
  await writeFile(path.join(contentDir, 'SKILL.md'), '# demo', 'utf8');

  const legacySkills = {
    schemaVersion: 1,
    packages: {
      demo: {
        versions: {
          '1.0.0': {
            integrity: 'sha512-demo',
            source: 'skills/demo/1.0.0',
            fileCount: 1,
            size: 1,
          },
        },
      },
    },
  };
  const legacyRoute = {
    schemaVersion: 1,
    targets: [
      {
        id: 'project-a',
        path: 'C:/tmp/project-a',
        mode: 'link',
        skills: {
          demo: {
            requested: '1.0.0',
            resolved: '1.0.0',
            integrity: 'sha512-demo',
            source: 'skills/demo/1.0.0',
          },
        },
      },
    ],
  };
  await writeFile(paths.skillsFile, JSON.stringify(legacySkills), 'utf8');
  await writeFile(paths.routeFile, JSON.stringify(legacyRoute), 'utf8');

  return {
    paths,
    legacySkills: await readFile(paths.skillsFile, 'utf8'),
    legacyRoute: await readFile(paths.routeFile, 'utf8'),
  };
}

afterEach(async () => {
  state.failWritePath = '';
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('migration failure handling', () => {
  it('removes partial new files and keeps v1 files when package.json write fails', async () => {
    const { paths, legacySkills, legacyRoute } = await setup();
    state.failWritePath = paths.packageFile;

    await expect(migrateV1ToV2(paths)).rejects.toThrow(/failed to write/i);
    state.failWritePath = '';

    expect(await readFile(paths.skillsFile, 'utf8')).toBe(legacySkills);
    expect(await readFile(paths.routeFile, 'utf8')).toBe(legacyRoute);
    expect(await pathExists(paths.skillFile)).toBe(false);
    expect(await pathExists(paths.packageFile)).toBe(false);
  });
});
