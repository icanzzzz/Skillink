import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import { apply } from './apply.js';
import { importFolder } from './import-folder.js';
import { addRouteEntry, removeRouteEntry } from './route.js';
import { status } from './status.js';
import { addTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup() {
  const root = await tempDir('skillink-status-');
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
  await addRouteEntry({ paths, targetId: 'project-a', name: 'demo', requested: '1.0.0' });
  return { paths, targetPath, source };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('status', () => {
  it('reports ok for a correctly linked package', async () => {
    const { paths } = await setup();
    await apply({ paths });

    const report = await status({ paths });

    expect(report.healthy).toBe(true);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'demo', state: 'ok', version: '1.0.0' }),
      ]),
    );
  });

  it('reports missing when the link is absent', async () => {
    const { paths, targetPath } = await setup();
    await apply({ paths });
    await rm(path.join(targetPath, 'demo'), { force: true });

    const report = await status({ paths });

    expect(report.healthy).toBe(false);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'demo', state: 'missing' }),
      ]),
    );
  });

  it('reports conflict for an unmanaged real folder', async () => {
    const { paths, targetPath } = await setup();
    const conflictPath = path.join(targetPath, 'demo');
    await mkdir(conflictPath);

    const report = await status({ paths });

    expect(report.healthy).toBe(false);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'demo', state: 'conflict' }),
      ]),
    );
  });

  it('reports wrong-version when the link points elsewhere', async () => {
    const { paths } = await setup();
    await apply({ paths });
    await addRouteEntry({ paths, targetId: 'project-a', name: 'demo', requested: '1.1.0' });

    const report = await status({ paths });

    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'demo', state: 'wrong-version' }),
      ]),
    );
  });

  it('reports extra managed links not present in the route', async () => {
    const { paths, source, targetPath } = await setup();
    await importFolder({ sourceDir: source, name: 'other', version: '1.0.0', home: paths.home });
    await addRouteEntry({ paths, targetId: 'project-a', name: 'other', requested: '1.0.0' });
    await apply({ paths });
    await removeRouteEntry({ paths, targetId: 'project-a', name: 'other' });

    const report = await status({ paths });

    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'other', state: 'extra' }),
      ]),
    );
    expect((await lstat(path.join(targetPath, 'other'))).isSymbolicLink()).toBe(true);
  });
});
