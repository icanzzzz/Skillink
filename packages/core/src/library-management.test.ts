import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths, type SkillinkPaths } from '@skillink/shared';
import { importFolder } from './import-folder.js';
import {
  readSkillsFile,
  removeLibraryVersion,
  setLibraryTag,
} from './library.js';
import { addRouteEntry } from './route.js';
import { addTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup(versions: string[] = ['1.0.0']): Promise<{
  root: string;
  paths: SkillinkPaths;
  targetPath: string;
}> {
  const root = await tempDir('skillink-library-');
  const paths = getSkillinkPaths(path.join(root, 'home'));
  const source = path.join(root, 'source');
  const targetPath = path.join(root, 'project', 'packages');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'file.txt'), `content-${versions.join('-')}`, 'utf8');
  await mkdir(targetPath, { recursive: true });

  for (const version of versions) {
    await importFolder({
      sourceDir: source,
      name: 'demo',
      version,
      home: paths.home,
    });
  }

  return { root, paths, targetPath };
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('library tags', () => {
  it('tags an existing version', async () => {
    const { paths } = await setup(['1.0.0', '1.1.0']);

    await setLibraryTag(paths, 'demo', '1.1.0', 'latest');

    const library = await readSkillsFile(paths);
    expect(library.packages.demo?.tags?.latest).toBe('1.1.0');
  });

  it('rejects tagging a missing package version', async () => {
    const { paths } = await setup();

    await expect(setLibraryTag(paths, 'demo', '9.9.9', 'latest')).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
  });

  it('rejects tagging a missing package', async () => {
    const { paths } = await setup();

    await expect(setLibraryTag(paths, 'missing', '1.0.0', 'latest')).rejects.toMatchObject({
      code: 'PACKAGE_NOT_FOUND',
    });
  });
});

describe('library version removal', () => {
  it('removes an unreferenced version and its content', async () => {
    const { paths } = await setup(['1.0.0', '1.1.0']);
    const versionDir = path.join(paths.libraryDir, 'demo', '1.0.0');

    await removeLibraryVersion(paths, 'demo', '1.0.0');

    const library = await readSkillsFile(paths);
    expect(library.packages.demo?.versions['1.0.0']).toBeUndefined();
    expect(library.packages.demo?.versions['1.1.0']).toBeDefined();
    expect(await pathExists(versionDir)).toBe(false);

    const trashEntries = await readdir(paths.trashDir);
    expect(trashEntries.length).toBeGreaterThan(0);
  });

  it('removes the package entry when the last version is removed', async () => {
    const { paths } = await setup(['1.0.0']);

    await removeLibraryVersion(paths, 'demo', '1.0.0');

    const library = await readSkillsFile(paths);
    expect(library.packages.demo).toBeUndefined();
  });

  it('refuses to remove a version referenced by a route', async () => {
    const { paths, targetPath } = await setup();
    await addTarget({ paths, id: 'project-a', path: targetPath });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'demo',
      requested: '1.0.0',
    });
    const versionDir = path.join(paths.libraryDir, 'demo', '1.0.0');

    await expect(removeLibraryVersion(paths, 'demo', '1.0.0')).rejects.toMatchObject({
      code: 'VERSION_IN_USE',
    });

    expect(await pathExists(versionDir)).toBe(true);
    const library = await readSkillsFile(paths);
    expect(library.packages.demo?.versions['1.0.0']).toBeDefined();
  });

  it('removes tags that point to the removed version', async () => {
    const { paths } = await setup(['1.0.0', '1.1.0']);
    await setLibraryTag(paths, 'demo', '1.0.0', 'stable');
    await setLibraryTag(paths, 'demo', '1.1.0', 'latest');

    await removeLibraryVersion(paths, 'demo', '1.0.0');

    const library = await readSkillsFile(paths);
    expect(library.packages.demo?.tags?.stable).toBeUndefined();
    expect(library.packages.demo?.tags?.latest).toBe('1.1.0');
  });

  it('rejects removing a missing version', async () => {
    const { paths } = await setup();

    await expect(removeLibraryVersion(paths, 'demo', '9.9.9')).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
  });
});
