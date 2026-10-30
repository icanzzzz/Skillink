import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSkillDir,
  getSkillinkPaths,
  type PackageFile,
  type SkillFile,
  type SkillinkPaths,
} from '@skillink/shared';
import { computePackageIntegrity } from './package-graph.js';
import {
  createPackageVersion,
  readPackageFile,
  setPackageTag,
  writePackageFile,
} from './package-store.js';
import {
  addRouteEntry,
  readRouteFile,
  removeRouteEntry,
  setPackageEnabled,
} from './route.js';
import { writeSkillFile } from './skill-store.js';
import { addTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function seedSkills(
  paths: SkillinkPaths,
  versions: Record<string, string[]>,
): Promise<void> {
  const file: SkillFile = { schemaVersion: 2, skills: {} };

  for (const [name, skillVersions] of Object.entries(versions)) {
    file.skills[name] = { versions: {} };
    for (const version of skillVersions) {
      file.skills[name].versions[version] = {
        integrity: `sha512-${name}-${version}`,
        fileCount: 1,
        size: 1,
        built: false,
      };
      const directory = getSkillDir(paths, name, version);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, 'SKILL.md'),
        `# ${name} ${version}`,
        'utf8',
      );
    }
  }

  await writeSkillFile(paths, file);
}

async function setup(): Promise<{
  paths: SkillinkPaths;
  targetPath: string;
}> {
  const root = await tempDir('skillink-route-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'project', 'skills');
  await mkdir(targetPath, { recursive: true });
  const paths = getSkillinkPaths(home);

  await seedSkills(paths, {
    pdf: ['1.0.0', '1.1.0', '1.2.0'],
    review: ['1.0.0'],
  });
  await createPackageVersion({
    paths,
    name: 'base',
    version: '2.0.0',
    skills: { review: '1.0.0' },
  });
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.0.0',
    packages: { base: '2.0.0' },
    skills: { pdf: '1.0.0' },
  });
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.1.0',
    packages: { base: '2.0.0' },
    skills: { pdf: '1.1.0' },
  });
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.2.0',
    packages: { base: '2.0.0' },
    skills: { pdf: '1.2.0' },
  });
  await setPackageTag(paths, 'frontend', '1.2.0', 'latest');
  await createPackageVersion({
    paths,
    name: 'docs',
    version: '1.0.0',
    skills: { pdf: '1.2.0' },
  });
  await createPackageVersion({
    paths,
    name: 'legacy',
    version: '1.0.0',
    skills: { pdf: '1.0.0' },
  });
  await addTarget({
    paths,
    id: 'project-a',
    label: 'Project A',
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

describe('route entries', () => {
  it('adds an exact package version with a transitive integrity', async () => {
    const { paths } = await setup();

    const lock = await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.0.0',
    });

    expect(lock).toMatchObject({
      requested: '1.0.0',
      resolved: '1.0.0',
      enabled: true,
    });
    expect(lock.integrity).toMatch(/^sha256-/);

    const route = await readRouteFile(paths);
    expect(route.targets[0]?.packages.frontend?.resolved).toBe('1.0.0');
    expect(route.targets[0]).not.toHaveProperty('skills');
  });

  it('resolves a semver range to the highest matching package version', async () => {
    const { paths } = await setup();

    const lock = await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '^1.0.0',
    });

    expect(lock.requested).toBe('^1.0.0');
    expect(lock.resolved).toBe('1.2.0');
  });

  it('resolves a package tag', async () => {
    const { paths } = await setup();

    const lock = await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: 'latest',
    });

    expect(lock.resolved).toBe('1.2.0');
  });

  it('records the integrity of the full package closure', async () => {
    const { paths } = await setup();
    const packageFile = await readPackageFile(paths);
    const expected = computePackageIntegrity(packageFile, [
      { name: 'frontend', version: '1.0.0' },
    ]);

    const lock = await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.0.0',
    });

    expect(lock.integrity).toBe(expected);
  });

  it('allows two packages that need the same skill at the same version', async () => {
    const { paths } = await setup();

    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.2.0',
    });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'docs',
      requested: '1.0.0',
    });

    const route = await readRouteFile(paths);
    expect(route.targets[0]?.packages.frontend?.resolved).toBe('1.2.0');
    expect(route.targets[0]?.packages.docs?.resolved).toBe('1.0.0');
  });

  it('rejects a skill version conflict without writing the route', async () => {
    const { paths } = await setup();

    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.2.0',
    });

    await expect(
      addRouteEntry({
        paths,
        targetId: 'project-a',
        name: 'legacy',
        requested: '1.0.0',
      }),
    ).rejects.toMatchObject({ code: 'SKILL_VERSION_CONFLICT' });

    const route = await readRouteFile(paths);
    expect(route.targets[0]?.packages.frontend?.resolved).toBe('1.2.0');
    expect(route.targets[0]?.packages.legacy).toBeUndefined();
  });

  it('rejects a package graph cycle without writing the route', async () => {
    const { paths } = await setup();
    const cyclic: PackageFile = {
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
    };
    await writePackageFile(paths, cyclic);

    await expect(
      addRouteEntry({
        paths,
        targetId: 'project-a',
        name: 'a',
        requested: '1.0.0',
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_CYCLE' });

    const route = await readRouteFile(paths);
    expect(route.targets[0]?.packages.a).toBeUndefined();
  });

  it('rejects missing packages and versions', async () => {
    const { paths } = await setup();

    await expect(
      addRouteEntry({
        paths,
        targetId: 'project-a',
        name: 'missing',
        requested: '1.0.0',
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND' });

    await expect(
      addRouteEntry({
        paths,
        targetId: 'project-a',
        name: 'frontend',
        requested: '9.9.9',
      }),
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('rejects removing an entry when the remaining graph is invalid', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.2.0',
    });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'docs',
      requested: '1.0.0',
    });
    const packageFile = await readPackageFile(paths);
    packageFile.packages.base!.versions['2.0.0']!.skills = {
      pdf: '9.9.9',
    };
    await writePackageFile(paths, packageFile);

    await expect(
      removeRouteEntry({
        paths,
        targetId: 'project-a',
        name: 'docs',
      }),
    ).rejects.toMatchObject({ code: 'ROUTE_INVALID' });

    const route = await readRouteFile(paths);
    expect(route.targets[0]?.packages.docs).toBeDefined();

    await expect(
      removeRouteEntry({
        paths,
        targetId: 'project-a',
        name: 'docs',
        force: true,
      }),
    ).resolves.toBe(true);
    expect(
      (await readRouteFile(paths)).targets[0]?.packages.docs,
    ).toBeUndefined();
  });

  it('enables and disables a package lock with history', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.0.0',
    });

    const disabled = await setPackageEnabled(
      paths,
      'project-a',
      'frontend',
      false,
    );
    expect(disabled.enabled).toBe(false);
    expect(
      (await readRouteFile(paths)).targets[0]?.packages.frontend?.enabled,
    ).toBe(false);

    const enabled = await setPackageEnabled(
      paths,
      'project-a',
      'frontend',
      true,
    );
    expect(enabled.enabled).toBe(true);

    await expect(
      setPackageEnabled(paths, 'project-a', 'missing', false),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND' });
  });

  it('removes a route entry without touching the target directory', async () => {
    const { paths, targetPath } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.0.0',
    });

    await expect(
      removeRouteEntry({
        paths,
        targetId: 'project-a',
        name: 'frontend',
      }),
    ).resolves.toBe(true);

    const route = await readRouteFile(paths);
    expect(route.targets[0]?.packages.frontend).toBeUndefined();
    expect((await stat(targetPath)).isDirectory()).toBe(true);
    await expect(
      removeRouteEntry({
        paths,
        targetId: 'project-a',
        name: 'frontend',
      }),
    ).resolves.toBe(false);
  });
});
