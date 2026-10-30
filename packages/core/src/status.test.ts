import {
  lstat,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSkillDir,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import { apply } from './apply.js';
import { importSkill } from './import-skill.js';
import { computePackageIntegrity } from './package-graph.js';
import {
  createPackageVersion,
  readPackageFile,
  writePackageFile,
} from './package-store.js';
import {
  addRouteEntry,
  readRouteFile,
  removeRouteEntry,
  writeRouteFile,
} from './route.js';
import { status } from './status.js';
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
  const source = await tempDir(`skillink-status-source-${name}-${version}-`);
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
  const root = await tempDir('skillink-status-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'project', 'skills');
  await mkdir(targetPath, { recursive: true });
  const paths = getSkillinkPaths(home);

  await importSkillVersion(home, 'pdf', '1.0.0');
  await importSkillVersion(home, 'pdf', '1.1.0');
  await importSkillVersion(home, 'review', '1.0.0');
  await importSkillVersion(home, 'docs', '1.0.0');

  for (const [name, version, skills] of [
    ['pdf-pack', '1.0.0', { pdf: '1.0.0' }],
    ['pdf-pack', '1.1.0', { pdf: '1.1.0' }],
    ['pdf-new', '1.0.0', { pdf: '1.1.0' }],
    ['pdf-old', '1.0.0', { pdf: '1.0.0' }],
    ['combo', '1.0.0', { pdf: '1.0.0', review: '1.0.0' }],
    ['docs-pack', '1.0.0', { docs: '1.0.0', review: '1.0.0' }],
    ['same', '1.0.0', { pdf: '1.0.0' }],
  ] as const) {
    await createPackageVersion({ paths, name, version, skills });
  }
  await addTarget({
    paths,
    id: 'project-a',
    path: targetPath,
    mode: 'link',
  });

  return { paths, targetPath };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('status', () => {
  it('reports ok for correctly linked skills', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'combo',
      requested: '1.0.0',
    });
    await apply({ paths });

    const report = await status({ paths });

    expect(report.healthy).toBe(true);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pdf', state: 'ok', version: '1.0.0' }),
        expect.objectContaining({
          name: 'review',
          state: 'ok',
          version: '1.0.0',
        }),
      ]),
    );
  });

  it('reports missing when a skill link is absent', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'combo',
      requested: '1.0.0',
    });
    await apply({ paths });
    await rm(path.join(targetPath, 'pdf'));

    const report = await status({ paths });

    expect(report.healthy).toBe(false);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pdf', state: 'missing' }),
      ]),
    );
  });

  it('reports conflict for an unmanaged real folder', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await mkdir(path.join(targetPath, 'pdf'));

    const report = await status({ paths });

    expect(report.healthy).toBe(false);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pdf', state: 'conflict' }),
      ]),
    );
  });

  it('reports wrong-version when the link points at an older skill version', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await apply({ paths });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.1.0',
    });

    const report = await status({ paths });

    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'pdf',
          state: 'wrong-version',
          version: '1.1.0',
          sourcePath: getSkillDir(paths, 'pdf', '1.1.0'),
        }),
      ]),
    );
  });

  it('reports extra managed links not present in the route', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'docs-pack',
      requested: '1.0.0',
    });
    await apply({ paths });
    await removeRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'docs-pack',
    });

    const report = await status({ paths });

    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'docs', state: 'extra' }),
        expect.objectContaining({ name: 'review', state: 'extra' }),
      ]),
    );
    expect(
      (await lstat(path.join(targetPath, 'docs'))).isSymbolicLink(),
    ).toBe(true);
  });

  it('reports a missing package version with packageName', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await writePackageFile(paths, { schemaVersion: 2, packages: {} });

    const report = await status({ paths });

    expect(report.healthy).toBe(false);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'pdf-pack',
          packageName: 'pdf-pack',
          state: 'missing',
        }),
      ]),
    );
  });

  it('deduplicates the same skill version from multiple packages', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'same',
      requested: '1.0.0',
    });

    const report = await status({ paths });

    expect(report.entries.filter((entry) => entry.name === 'pdf')).toHaveLength(
      1,
    );
  });

  it('reports a skill version conflict for the target', async () => {
    const { paths } = await setup();
    const packageFile = await readPackageFile(paths);
    const route = await readRouteFile(paths);
    const target = route.targets[0]!;
    target.packages['pdf-new'] = {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: computePackageIntegrity(packageFile, [
        { name: 'pdf-new', version: '1.0.0' },
      ]),
      enabled: true,
    };
    target.packages['pdf-old'] = {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: computePackageIntegrity(packageFile, [
        { name: 'pdf-old', version: '1.0.0' },
      ]),
      enabled: true,
    };
    await writeRouteFile(paths, route);

    const report = await status({ paths });

    expect(report.healthy).toBe(false);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'conflict',
          detail: expect.stringContaining('SKILL_VERSION_CONFLICT'),
        }),
      ]),
    );
  });

  it('marks a disabled target as disabled and keeps the report healthy', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'combo',
      requested: '1.0.0',
    });
    const route = await readRouteFile(paths);
    route.targets[0]!.enabled = false;
    await writeRouteFile(paths, route);

    const report = await status({ paths });

    expect(report.healthy).toBe(true);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '<target>',
          state: 'disabled',
          targetId: 'project-a',
        }),
      ]),
    );
  });
});
