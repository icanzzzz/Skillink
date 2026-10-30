import { lstat, mkdir, mkdtemp, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import { apply } from './apply.js';
import { importFolder } from './import-folder.js';
import { addRouteEntry, readRouteFile, removeRouteEntry, writeRouteFile } from './route.js';
import { addTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup() {
  const root = await tempDir('skillink-apply-');
  const home = path.join(root, 'home');
  const source = path.join(root, 'source');
  const targetPath = path.join(root, 'project', 'packages');
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'file.txt'), 'content', 'utf8');
  await mkdir(targetPath, { recursive: true });
  await importFolder({ sourceDir: source, name: 'demo', version: '1.0.0', home });
  await importFolder({ sourceDir: source, name: 'demo', version: '1.1.0', home });
  const paths = getSkillinkPaths(home);
  await addTarget({ paths, id: 'project-a', path: targetPath, mode: 'link' });
  await addRouteEntry({
    paths,
    targetId: 'project-a',
    name: 'demo',
    requested: '1.0.0',
  });
  return { root, home, source, targetPath, paths };
}

async function linkTarget(linkPath: string): Promise<string> {
  return path.resolve(path.dirname(linkPath), await readlink(linkPath));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('apply', () => {
  it('creates a managed link for each route entry', async () => {
    const { paths, targetPath } = await setup();

    const report = await apply({ paths });

    expect(report.ok).toBe(true);
    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'create-link', name: 'demo' }),
      ]),
    );
    const destination = path.join(targetPath, 'demo');
    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    expect(await linkTarget(destination)).toBe(
      path.join(paths.libraryDir, 'demo', '1.0.0'),
    );
  });

  it('does not change the target on dry-run', async () => {
    const { paths, targetPath } = await setup();

    const report = await apply({ paths, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'create-link', name: 'demo' }),
      ]),
    );
    await expect(lstat(path.join(targetPath, 'demo'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('skips a link that already points at the correct version', async () => {
    const { paths } = await setup();
    await apply({ paths });

    const report = await apply({ paths });

    expect(report.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'skip', name: 'demo' }),
      ]),
    );
  });

  it('replaces a managed link when the route version changes', async () => {
    const { paths, targetPath } = await setup();
    await apply({ paths });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'demo',
      requested: '1.1.0',
    });

    const report = await apply({ paths });

    expect(report.ok).toBe(true);
    expect(await linkTarget(path.join(targetPath, 'demo'))).toBe(
      path.join(paths.libraryDir, 'demo', '1.1.0'),
    );
  });

  it('reports an unmanaged folder conflict without deleting it', async () => {
    const { paths, targetPath } = await setup();
    const conflictPath = path.join(targetPath, 'demo');
    await mkdir(conflictPath);
    await writeFile(path.join(conflictPath, 'keep.txt'), 'keep', 'utf8');

    const report = await apply({ paths });

    expect(report.ok).toBe(false);
    expect(report.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'demo', path: conflictPath }),
      ]),
    );
    await expect(
      writeFile(path.join(conflictPath, 'keep.txt'), 'still here', 'utf8'),
    ).resolves.toBeUndefined();
  });

  it('prunes only managed links that are no longer in the route', async () => {
    const { paths, source, targetPath } = await setup();
    await importFolder({ sourceDir: source, name: 'other', version: '1.0.0', home: paths.home });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'other',
      requested: '1.0.0',
    });
    await apply({ paths });
    await removeRouteEntry({ paths, targetId: 'project-a', name: 'other' });

    const report = await apply({ paths, prune: true });

    expect(report.ok).toBe(true);
    await expect(lstat(path.join(targetPath, 'other'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await lstat(path.join(targetPath, 'demo'))).isSymbolicLink()).toBe(true);
    expect((await readdir(targetPath)).sort()).toEqual(['demo']);
  });

  it('rejects a route that references a missing library version', async () => {
    const { paths } = await setup();
    const route = await readRouteFile(paths);
    route.targets[0]!.skills.demo = {
      requested: '9.9.9',
      resolved: '9.9.9',
      integrity: 'sha512-missing',
      source: 'skills/demo/9.9.9',
      enabled: true,
    };
    await writeRouteFile(paths, route);

    await expect(apply({ paths })).rejects.toThrow(/missing|version/i);
  });

  it('exposes the resolved source path in the report', async () => {
    const { paths, targetPath } = await setup();
    const report = await apply({ paths, dryRun: true });
    const operation = report.operations.find((entry) => entry.kind === 'create-link');

    expect(operation?.sourcePath).toBe(
      path.join(paths.libraryDir, 'demo', '1.0.0'),
    );
    expect(operation?.path).toBe(path.join(targetPath, 'demo'));
  });
});
