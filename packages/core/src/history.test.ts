import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths, type SkillinkPaths } from '@skillink/shared';
import { importFolder } from './import-folder.js';
import {
  createHistorySnapshot,
  listHistory,
  restoreHistorySnapshot,
} from './history.js';
import { readRouteFile, addRouteEntry } from './route.js';
import { readSkillsFile, removeLibraryVersion } from './library.js';
import { addTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup(): Promise<{
  root: string;
  paths: SkillinkPaths;
  targetPath: string;
}> {
  const root = await tempDir('skillink-history-');
  const paths = getSkillinkPaths(path.join(root, 'home'));
  const targetPath = path.join(root, 'project', 'packages');
  await mkdir(targetPath, { recursive: true });
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

describe('history snapshots', () => {
  it('writes route.json and skills.json snapshots when a target is added', async () => {
    const { paths, targetPath } = await setup();

    await addTarget({ paths, id: 'project-a', path: targetPath });

    const entries = await listHistory(paths);
    expect(entries).toHaveLength(1);

    const snapshotRoute = JSON.parse(
      await readFile(path.join(entries[0]!.path, 'route.json'), 'utf8'),
    ) as { schemaVersion: number; targets: unknown[] };
    const snapshotSkills = JSON.parse(
      await readFile(path.join(entries[0]!.path, 'skills.json'), 'utf8'),
    ) as { schemaVersion: number; packages: Record<string, unknown> };

    expect(snapshotRoute.schemaVersion).toBe(1);
    expect(snapshotRoute.targets).toEqual([]);
    expect(snapshotSkills).toEqual({ schemaVersion: 1, packages: {} });
  });

  it('writes empty defaults for a snapshot created before configs exist', async () => {
    const { paths } = await setup();

    const entry = await createHistorySnapshot(paths, 'manual');

    const snapshotRoute = JSON.parse(
      await readFile(path.join(entry.path, 'route.json'), 'utf8'),
    ) as { targets: unknown[] };
    const snapshotSkills = JSON.parse(
      await readFile(path.join(entry.path, 'skills.json'), 'utf8'),
    ) as { packages: Record<string, unknown> };

    expect(snapshotRoute.targets).toEqual([]);
    expect(snapshotSkills.packages).toEqual({});
  });

  it('lists snapshots newest first', async () => {
    const { paths, targetPath } = await setup();

    await addTarget({ paths, id: 'project-a', path: targetPath });
    await addTarget({
      paths,
      id: 'project-b',
      path: path.join(path.dirname(targetPath), 'other'),
    });

    const entries = await listHistory(paths);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.createdAt >= entries[1]!.createdAt).toBe(true);
    expect(entries[0]!.reason).toContain('target');
  });

  it('uses snapshot directory names without colons', async () => {
    const { paths } = await setup();

    await createHistorySnapshot(paths, 'manual');
    const entries = await listHistory(paths);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).not.toContain(':');
    expect(path.basename(entries[0]!.path)).toBe(entries[0]!.id);
  });

  it('restores route.json and skills.json together', async () => {
    const { root, paths, targetPath } = await setup();
    await addTarget({ paths, id: 'project-a', path: targetPath });
    await addTarget({
      paths,
      id: 'project-b',
      path: path.join(root, 'project-b'),
    });

    const snapshot = (await listHistory(paths))[0]!;

    const source = path.join(root, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'file.txt'), 'content', 'utf8');
    await importFolder({ sourceDir: source, name: 'demo', version: '1.0.0', home: paths.home });

    expect(Object.keys((await readSkillsFile(paths)).packages)).toContain('demo');
    expect((await readRouteFile(paths)).targets).toHaveLength(2);

    const before = await listHistory(paths);
    await restoreHistorySnapshot(paths, snapshot.id);

    const restoredRoute = await readRouteFile(paths);
    const restoredSkills = await readSkillsFile(paths);
    expect(restoredRoute.targets.map((target) => target.id)).toEqual(['project-a']);
    expect(restoredSkills.packages).toEqual({});

    const after = await listHistory(paths);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it('rejects an unknown snapshot id with HISTORY_NOT_FOUND', async () => {
    const { paths } = await setup();

    await expect(restoreHistorySnapshot(paths, 'missing-snapshot')).rejects.toMatchObject({
      code: 'HISTORY_NOT_FOUND',
    });
  });

  it('rejects a snapshot id containing path traversal', async () => {
    const { paths } = await setup();

    await expect(
      restoreHistorySnapshot(paths, '../../outside'),
    ).rejects.toMatchObject({ code: 'HISTORY_NOT_FOUND' });
  });

  it('keeps at most 50 snapshots', async () => {
    const { paths } = await setup();

    for (let index = 0; index < 52; index += 1) {
      await createHistorySnapshot(paths, `manual-${index}`);
    }

    expect((await listHistory(paths)).length).toBeLessThanOrEqual(50);
  });

  it('restores content moved to trash when the snapshot references it', async () => {
    const { root, paths, targetPath } = await setup();
    const source = path.join(root, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'file.txt'), 'content', 'utf8');
    await importFolder({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home: paths.home,
    });
    await importFolder({
      sourceDir: source,
      name: 'demo',
      version: '1.1.0',
      home: paths.home,
    });
    await addTarget({ paths, id: 'project-a', path: targetPath });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'demo',
      requested: '1.0.0',
    });

    const snapshot = (await listHistory(paths))[0]!;
    const removedContent = path.join(paths.libraryDir, 'demo', '1.1.0');
    await removeLibraryVersion(paths, 'demo', '1.1.0');
    expect(await pathExists(removedContent)).toBe(false);

    await restoreHistorySnapshot(paths, snapshot.id);

    expect(await pathExists(removedContent)).toBe(true);
    const restoredSkills = await readSkillsFile(paths);
    expect(restoredSkills.packages.demo?.versions['1.1.0']).toBeDefined();
  });

  it('refuses to restore when snapshot content is missing and not in trash', async () => {
    const { root, paths } = await setup();
    const source = path.join(root, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'file.txt'), 'content', 'utf8');
    await importFolder({
      sourceDir: source,
      name: 'demo',
      version: '1.0.0',
      home: paths.home,
    });
    const snapshot = await createHistorySnapshot(paths, 'manual');
    const content = path.join(paths.libraryDir, 'demo', '1.0.0');
    await rm(content, { recursive: true, force: true });
    const routeBefore = await readRouteFile(paths);

    await expect(restoreHistorySnapshot(paths, snapshot.id)).rejects.toMatchObject({
      code: 'VERSION_NOT_FOUND',
    });
    await expect(readRouteFile(paths)).resolves.toEqual(routeBefore);
  });
});
