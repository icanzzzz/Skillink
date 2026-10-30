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
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmptyPackageFile,
  getSkillDir,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import {
  createHistorySnapshot,
  listHistory,
  restoreHistorySnapshot,
} from './history.js';
import { importSkill } from './import-skill.js';
import {
  createPackageVersion,
  readPackageFile,
  writePackageFile,
} from './package-store.js';
import {
  addRouteEntry,
  readRouteFile,
} from './route.js';
import { readSkillFile, removeSkillVersion } from './skill-store.js';
import { addTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function importSkillVersion(
  home: string,
  name: string,
  version: string,
): Promise<void> {
  const source = await tempDir(`skillink-history-source-${name}-${version}-`);
  await writeFile(path.join(source, 'SKILL.md'), `# ${name} ${version}`, 'utf8');
  await writeFile(
    path.join(source, 'content.txt'),
    `${name}@${version}`,
    'utf8',
  );
  await importSkill({ sourceDir: source, name, version, home });
}

async function setup(): Promise<{
  paths: SkillinkPaths;
  targetPath: string;
}> {
  const root = await tempDir('skillink-history-');
  const paths = getSkillinkPaths(path.join(root, 'home'));
  const targetPath = path.join(root, 'project', 'skills');
  await mkdir(targetPath, { recursive: true });
  return { paths, targetPath };
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function readSnapshotJson(
  snapshotPath: string,
  name: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(snapshotPath, name), 'utf8'),
  ) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('history snapshots', () => {
  it('writes route.json, package.json, and skill.json snapshots', async () => {
    const { paths, targetPath } = await setup();

    await addTarget({ paths, id: 'project-a', path: targetPath });

    const entries = await listHistory(paths);
    expect(entries).toHaveLength(1);

    const route = await readSnapshotJson(entries[0]!.path, 'route.json');
    const packages = await readSnapshotJson(entries[0]!.path, 'package.json');
    const skills = await readSnapshotJson(entries[0]!.path, 'skill.json');

    expect(route.schemaVersion).toBe(2);
    expect(route.targets).toEqual([]);
    expect(packages).toEqual({ schemaVersion: 2, packages: {} });
    expect(skills).toEqual({ schemaVersion: 2, skills: {} });
  });

  it('writes empty defaults before any config exists', async () => {
    const { paths } = await setup();

    const entry = await createHistorySnapshot(paths, 'manual');

    expect(await readSnapshotJson(entry.path, 'route.json')).toEqual({
      schemaVersion: 2,
      targets: [],
    });
    expect(await readSnapshotJson(entry.path, 'package.json')).toEqual({
      schemaVersion: 2,
      packages: {},
    });
    expect(await readSnapshotJson(entry.path, 'skill.json')).toEqual({
      schemaVersion: 2,
      skills: {},
    });
  });

  it('lists snapshots newest first and keeps at most 50', async () => {
    const { paths } = await setup();

    for (let index = 0; index < 52; index += 1) {
      await createHistorySnapshot(paths, `manual-${index}`);
    }

    const entries = await listHistory(paths);
    expect(entries.length).toBeLessThanOrEqual(50);
    expect(entries[0]!.createdAt >= entries[1]!.createdAt).toBe(true);
    expect(entries[0]!.id).not.toContain(':');
  });

  it('restores all three config files together', async () => {
    const { paths, targetPath } = await setup();
    await importSkillVersion(paths.home, 'demo', '1.0.0');
    await createPackageVersion({
      paths,
      name: 'demo-pack',
      version: '1.0.0',
      skills: { demo: '1.0.0' },
    });
    await addTarget({ paths, id: 'project-a', path: targetPath });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'demo-pack',
      requested: '1.0.0',
    });

    const snapshot = await createHistorySnapshot(paths, 'before-change');

    const otherTargetPath = path.join(path.dirname(targetPath), 'other');
    await mkdir(otherTargetPath, { recursive: true });
    await importSkillVersion(paths.home, 'other', '1.0.0');
    await createPackageVersion({
      paths,
      name: 'other-pack',
      version: '1.0.0',
      skills: { other: '1.0.0' },
    });
    await addTarget({ paths, id: 'project-b', path: otherTargetPath });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'other-pack',
      requested: '1.0.0',
    });

    await restoreHistorySnapshot(paths, snapshot.id);

    const route = await readRouteFile(paths);
    const packages = await readPackageFile(paths);
    const skills = await readSkillFile(paths);

    expect(route.targets.map((target) => target.id)).toEqual(['project-a']);
    expect(route.targets[0]?.packages['demo-pack']).toBeDefined();
    expect(route.targets[0]?.packages['other-pack']).toBeUndefined();
    expect(packages.packages['other-pack']).toBeUndefined();
    expect(skills.skills.other).toBeUndefined();
    expect(skills.skills.demo?.versions['1.0.0']).toBeDefined();
  });

  it('rejects a snapshot whose package graph has a cycle', async () => {
    const { paths } = await setup();
    await writePackageFile(paths, {
      schemaVersion: 2,
      packages: {
        a: {
          versions: {
            '1.0.0': { packages: { b: '1.0.0' }, skills: {} },
          },
        },
        b: {
          versions: {
            '1.0.0': { packages: { a: '1.0.0' }, skills: {} },
          },
        },
      },
    });
    const snapshot = await createHistorySnapshot(paths, 'cycle');
    await writePackageFile(paths, createEmptyPackageFile());

    await expect(
      restoreHistorySnapshot(paths, snapshot.id),
    ).rejects.toMatchObject({ code: 'PACKAGE_CYCLE' });

    expect((await readPackageFile(paths)).packages).toEqual({});
  });

  it('restores skill content moved to trash when the snapshot references it', async () => {
    const { paths } = await setup();
    await importSkillVersion(paths.home, 'demo', '1.0.0');
    const snapshot = await createHistorySnapshot(paths, 'with-content');
    const contentDir = getSkillDir(paths, 'demo', '1.0.0');

    await removeSkillVersion(paths, 'demo', '1.0.0');
    expect(await pathExists(contentDir)).toBe(false);

    await restoreHistorySnapshot(paths, snapshot.id);

    expect(await pathExists(contentDir)).toBe(true);
    expect(
      (await readSkillFile(paths)).skills.demo?.versions['1.0.0'],
    ).toBeDefined();
  });

  it('refuses to restore when snapshot content is missing and not in trash', async () => {
    const { paths } = await setup();
    await importSkillVersion(paths.home, 'demo', '1.0.0');
    const snapshot = await createHistorySnapshot(paths, 'with-content');
    const contentDir = getSkillDir(paths, 'demo', '1.0.0');
    await rm(contentDir, { recursive: true, force: true });
    const skillBefore = await readSkillFile(paths);

    await expect(
      restoreHistorySnapshot(paths, snapshot.id),
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });

    expect(await readSkillFile(paths)).toEqual(skillBefore);
  });

  it('ignores and cannot restore old v1 snapshots', async () => {
    const { paths } = await setup();
    const oldSnapshot = path.join(paths.historyDir, 'old-v1');
    await mkdir(oldSnapshot, { recursive: true });
    await writeFile(
      path.join(oldSnapshot, 'meta.json'),
      JSON.stringify({
        id: 'old-v1',
        createdAt: '2026-01-01T00:00:00.000Z',
        reason: 'legacy',
      }),
      'utf8',
    );

    expect(await listHistory(paths)).toEqual([]);
    await expect(
      restoreHistorySnapshot(paths, 'old-v1'),
    ).rejects.toMatchObject({ code: 'HISTORY_NOT_FOUND' });
  });
});
