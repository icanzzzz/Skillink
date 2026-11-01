import {
  cp,
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
import { createDirectoryLink } from './links.js';
import { computePackageIntegrity } from './package-graph.js';
import {
  createPackageVersion,
  readPackageFile,
  writePackageFile,
} from './package-store.js';
import {
  addRouteEntry,
  readRouteFile,
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

async function useCopyTarget(paths: SkillinkPaths): Promise<void> {
  const route = await readRouteFile(paths);
  route.targets[0]!.mode = 'copy';
  await writeRouteFile(paths, route);
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

  it('reports wrong-mode for a same-name real folder', async () => {
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
        expect.objectContaining({ name: 'pdf', state: 'wrong-mode' }),
      ]),
    );
  });

  it('reports broken-link for a dangling skill link', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    const missing = path.join(
      await tempDir('skillink-status-missing-target-'),
      'gone',
    );
    await mkdir(missing);
    const destination = path.join(targetPath, 'pdf');
    await createDirectoryLink(missing, destination);
    await rm(missing, { recursive: true, force: true });

    const report = await status({ paths });

    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pdf', state: 'broken-link' }),
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

  it('ignores links outside the route', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await apply({ paths });
    await createDirectoryLink(
      getSkillDir(paths, 'review', '1.0.0'),
      path.join(targetPath, 'review'),
    );

    const report = await status({ paths });

    expect(report.healthy).toBe(true);
    expect(report.entries.some((entry) => entry.name === 'review')).toBe(false);
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

  it('reports every stale route lock', async () => {
    const { paths } = await setup();
    for (const name of ['combo', 'docs-pack']) {
      await addRouteEntry({
        paths,
        targetId: 'project-a',
        name,
        requested: '1.0.0',
      });
    }
    const route = await readRouteFile(paths);
    route.targets[0]!.packages.combo!.integrity = 'sha256-wrong';
    route.targets[0]!.packages['docs-pack']!.integrity = 'sha256-wrong';
    await writeRouteFile(paths, route);

    const report = await status({ paths });
    const stale = report.entries.filter((entry) =>
      entry.detail?.includes('PACKAGE_INTEGRITY_MISMATCH'),
    );

    expect(stale.map((entry) => entry.name)).toEqual(['combo', 'docs-pack']);
  });

  it('reports ok for correctly copied skills', async () => {
    const { paths } = await setup();
    await useCopyTarget(paths);
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

  it('reports missing when a copy entry is absent', async () => {
    const { paths, targetPath } = await setup();
    await useCopyTarget(paths);
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'combo',
      requested: '1.0.0',
    });
    await apply({ paths });
    await rm(path.join(targetPath, 'pdf'), { recursive: true, force: true });

    const report = await status({ paths });

    expect(report.healthy).toBe(false);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pdf', state: 'missing' }),
      ]),
    );
  });

  it('reports wrong-version for a modified copy directory', async () => {
    const { paths, targetPath } = await setup();
    await useCopyTarget(paths);
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'combo',
      requested: '1.0.0',
    });
    await apply({ paths });
    await writeFile(path.join(targetPath, 'pdf', 'content.txt'), 'changed', 'utf8');

    const report = await status({ paths });

    expect(report.healthy).toBe(false);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pdf', state: 'wrong-version' }),
      ]),
    );
  });

  it('reports wrong-mode for a link in a copy target', async () => {
    const { paths, targetPath } = await setup();
    await useCopyTarget(paths);
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await createDirectoryLink(
      getSkillDir(paths, 'pdf', '1.0.0'),
      path.join(targetPath, 'pdf'),
    );

    const report = await status({ paths });

    expect(report.healthy).toBe(false);
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'pdf', state: 'wrong-mode' }),
      ]),
    );
  });

  it('ignores copy entries outside the route', async () => {
    const { paths, targetPath } = await setup();
    await useCopyTarget(paths);
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'pdf-pack',
      requested: '1.0.0',
    });
    await apply({ paths });
    await cp(getSkillDir(paths, 'review', '1.0.0'), path.join(targetPath, 'review'), {
      recursive: true,
    });

    const report = await status({ paths });

    expect(report.healthy).toBe(true);
    expect(report.entries.some((entry) => entry.name === 'review')).toBe(false);
  });
});
