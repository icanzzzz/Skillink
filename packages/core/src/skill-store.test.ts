import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmptySkillFile,
  getSkillDir,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import {
  readSkillFile,
  removeSkillVersion,
  setSkillTag,
  upsertSkillVersion,
  writeSkillFile,
} from './skill-store.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup(): Promise<{ root: string; paths: SkillinkPaths }> {
  const root = await tempDir('skillink-skill-store-');
  return { root, paths: getSkillinkPaths(path.join(root, 'home')) };
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function writePackageFile(
  paths: SkillinkPaths,
  skills: Record<string, string>,
): Promise<void> {
  await writeFile(
    paths.packageFile,
    JSON.stringify({
      schemaVersion: 2,
      packages: {
        frontend: {
          versions: {
            '1.0.0': {
              packages: {},
              skills,
            },
          },
        },
      },
    }),
    'utf8',
  );
}

async function writeRouteFile(
  paths: SkillinkPaths,
  packageName: string,
  version: string,
): Promise<void> {
  await writeFile(
    paths.routeFile,
    JSON.stringify({
      schemaVersion: 2,
      targets: [
        {
          id: 'project-a',
          path: 'C:/tmp/target',
          mode: 'link',
          packages: {
            [packageName]: {
              requested: version,
              resolved: version,
              integrity: 'sha256-x',
            },
          },
        },
      ],
    }),
    'utf8',
  );
}

async function upsertDemo(
  paths: SkillinkPaths,
  version = '1.0.0',
): Promise<{ created: boolean }> {
  return upsertSkillVersion(paths, {
    name: 'demo',
    version,
    integrity: `sha512-${version}`,
    fileCount: 1,
    size: 10,
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('skill file store', () => {
  it('writes and reads an empty skill file', async () => {
    const { paths } = await setup();

    await writeSkillFile(paths, createEmptySkillFile());

    expect(await readSkillFile(paths)).toEqual({
      schemaVersion: 2,
      skills: {},
    });
  });

  it('creates a skill version without a source path', async () => {
    const { paths } = await setup();

    await expect(upsertDemo(paths)).resolves.toEqual({ created: true });

    const file = await readSkillFile(paths);
    expect(file.skills.demo?.versions['1.0.0']).toEqual({
      integrity: 'sha512-1.0.0',
      fileCount: 1,
      size: 10,
      built: false,
    });
    expect(file.skills.demo?.versions['1.0.0']).not.toHaveProperty('source');
  });

  it('reuses the same version and integrity', async () => {
    const { paths } = await setup();
    await upsertDemo(paths);

    await expect(upsertDemo(paths)).resolves.toEqual({ created: false });
  });

  it('rejects the same version with different integrity', async () => {
    const { paths } = await setup();
    await upsertDemo(paths);

    await expect(
      upsertSkillVersion(paths, {
        name: 'demo',
        version: '1.0.0',
        integrity: 'sha512-other',
        fileCount: 1,
        size: 10,
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_EXISTS' });
  });

  it('tags an existing skill version', async () => {
    const { paths } = await setup();
    await upsertDemo(paths);

    await setSkillTag(paths, 'demo', '1.0.0', 'latest');

    expect((await readSkillFile(paths)).skills.demo?.tags?.latest).toBe('1.0.0');
  });

  it('rejects tagging a missing skill or version', async () => {
    const { paths } = await setup();
    await upsertDemo(paths);

    await expect(
      setSkillTag(paths, 'missing', '1.0.0', 'latest'),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND' });
    await expect(
      setSkillTag(paths, 'demo', '9.9.9', 'latest'),
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });
});

describe('removeSkillVersion', () => {
  it('moves unreferenced content to trash and updates skill.json', async () => {
    const { paths } = await setup();
    await upsertDemo(paths, '1.0.0');
    await upsertDemo(paths, '1.1.0');
    const versionDir = getSkillDir(paths, 'demo', '1.0.0');
    await mkdir(versionDir, { recursive: true });
    await writeFile(path.join(versionDir, 'SKILL.md'), 'demo', 'utf8');

    await removeSkillVersion(paths, 'demo', '1.0.0');

    expect(await pathExists(versionDir)).toBe(false);
    const file = await readSkillFile(paths);
    expect(file.skills.demo?.versions['1.0.0']).toBeUndefined();
    expect(file.skills.demo?.versions['1.1.0']).toBeDefined();
    expect((await readdir(paths.trashDir)).length).toBeGreaterThan(0);
  });

  it('removes the skill entry when the last version is removed', async () => {
    const { paths } = await setup();
    await upsertDemo(paths);

    await removeSkillVersion(paths, 'demo', '1.0.0');

    expect((await readSkillFile(paths)).skills.demo).toBeUndefined();
  });

  it('removes the empty skill parent directory when the last version is removed', async () => {
    const { paths } = await setup();
    await upsertDemo(paths);
    const versionDir = getSkillDir(paths, 'demo', '1.0.0');
    await mkdir(versionDir, { recursive: true });
    await writeFile(path.join(versionDir, 'SKILL.md'), '# demo', 'utf8');

    await removeSkillVersion(paths, 'demo', '1.0.0');

    expect(await pathExists(path.join(paths.libraryDir, 'demo'))).toBe(false);
  });

  it('refuses to remove a version referenced by a route package closure', async () => {
    const { paths } = await setup();
    await upsertDemo(paths);
    await writePackageFile(paths, { demo: '1.0.0' });
    await writeRouteFile(paths, 'frontend', '1.0.0');

    await expect(
      removeSkillVersion(paths, 'demo', '1.0.0'),
    ).rejects.toMatchObject({ code: 'VERSION_IN_USE' });
  });

  it('refuses to remove a tagged version', async () => {
    const { paths } = await setup();
    await upsertDemo(paths);
    await setSkillTag(paths, 'demo', '1.0.0', 'stable');

    await expect(
      removeSkillVersion(paths, 'demo', '1.0.0'),
    ).rejects.toMatchObject({ code: 'VERSION_IN_USE' });
  });

  it('allows removing a version referenced only by an unused package', async () => {
    const { paths } = await setup();
    await upsertDemo(paths);
    await writePackageFile(paths, { demo: '1.0.0' });

    await expect(
      removeSkillVersion(paths, 'demo', '1.0.0'),
    ).resolves.toBeUndefined();

    expect((await readSkillFile(paths)).skills.demo).toBeUndefined();
    expect(await pathExists(paths.packageFile)).toBe(true);
  });

  it('rejects removing a missing version', async () => {
    const { paths } = await setup();
    await upsertDemo(paths);

    await expect(
      removeSkillVersion(paths, 'demo', '9.9.9'),
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });
});
