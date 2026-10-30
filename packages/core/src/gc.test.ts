import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths, type SkillinkPaths } from '@skillink/shared';
import { gc, planGc } from './gc.js';
import { importFolder } from './import-folder.js';
import { readSkillsFile, setLibraryTag } from './library.js';
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
  const root = await tempDir('skillink-gc-');
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

describe('garbage collection', () => {
  it('reports candidates in a dry run without changing anything', async () => {
    const { paths } = await setup(['1.0.0']);
    const versionDir = path.join(paths.libraryDir, 'demo', '1.0.0');

    const report = await gc(paths, { maxAgeDays: 0 });

    expect(report.dryRun).toBe(true);
    expect(report.candidates).toEqual([
      expect.objectContaining({ name: 'demo', version: '1.0.0' }),
    ]);
    expect(report.removed).toEqual([]);
    expect(await pathExists(versionDir)).toBe(true);
    expect((await readSkillsFile(paths)).packages.demo?.versions['1.0.0']).toBeDefined();
  });

  it('moves unreferenced versions to trash and updates skills.json', async () => {
    const { paths } = await setup(['1.0.0']);
    const versionDir = path.join(paths.libraryDir, 'demo', '1.0.0');

    const report = await gc(paths, { dryRun: false, maxAgeDays: 0 });

    expect(report.dryRun).toBe(false);
    expect(report.removed).toEqual([
      expect.objectContaining({ name: 'demo', version: '1.0.0' }),
    ]);
    expect(report.freedBytes).toBeGreaterThan(0);
    expect(await pathExists(versionDir)).toBe(false);
    expect((await readSkillsFile(paths)).packages.demo).toBeUndefined();

    const trashEntries = await readdir(paths.trashDir);
    expect(trashEntries.length).toBeGreaterThan(0);
  });

  it('never considers a version referenced by a route', async () => {
    const { paths, targetPath } = await setup(['1.0.0', '1.1.0']);
    await addTarget({ paths, id: 'project-a', path: targetPath });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'demo',
      requested: '1.0.0',
    });

    const report = await planGc(paths, { maxAgeDays: 0 });

    expect(report.candidates.map((candidate) => candidate.version)).toEqual(['1.1.0']);
  });

  it('keeps tagged versions when keepTagged is true', async () => {
    const { paths } = await setup(['1.0.0', '1.1.0']);
    await setLibraryTag(paths, 'demo', '1.0.0', 'latest');

    const taggedOnly = await planGc(paths, { maxAgeDays: 0 });
    expect(taggedOnly.candidates.map((candidate) => candidate.version)).toEqual(['1.1.0']);

    const all = await planGc(paths, { maxAgeDays: 0, keepTagged: false });
    expect(all.candidates.map((candidate) => candidate.version)).toEqual([
      '1.0.0',
      '1.1.0',
    ]);
  });

  it('respects maxAgeDays for recent versions', async () => {
    const { paths } = await setup(['1.0.0']);

    const report = await planGc(paths, { maxAgeDays: 7 });

    expect(report.candidates).toEqual([]);
  });
});
