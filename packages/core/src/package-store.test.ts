import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSkillinkPaths,
  type PackageFile,
  type SkillFile,
  type SkillinkPaths,
} from '@skillink/shared';
import {
  copyPackageVersion,
  createPackageVersion,
  readPackageFile,
  removePackageVersion,
  resolvePackageVersion,
  setPackageTag,
  writePackageFile,
} from './package-store.js';
import { listHistory } from './history.js';
import { writeSkillFile } from './skill-store.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup(): Promise<SkillinkPaths> {
  const root = await tempDir('skillink-package-store-');
  return getSkillinkPaths(path.join(root, 'home'));
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
    }
  }

  await writeSkillFile(paths, file);
}

function packageFile(
  entries: Record<
    string,
    {
      tags?: Record<string, string>;
      versions: Record<
        string,
        { packages?: Record<string, string>; skills?: Record<string, string> }
      >;
    }
  >,
): PackageFile {
  return {
    schemaVersion: 2,
    packages: Object.fromEntries(
      Object.entries(entries).map(([name, entry]) => [
        name,
        {
          ...(entry.tags ? { tags: entry.tags } : {}),
          versions: Object.fromEntries(
            Object.entries(entry.versions).map(([version, value]) => [
              version,
              {
                packages: value.packages ?? {},
                skills: value.skills ?? {},
              },
            ]),
          ),
        },
      ]),
    ),
  };
}

async function seedRoute(
  paths: SkillinkPaths,
  packages: Record<string, { resolved: string; enabled?: boolean }>,
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
          ...(Object.values(packages).some((lock) => lock.enabled === false)
            ? { enabled: false }
            : {}),
          packages: Object.fromEntries(
            Object.entries(packages).map(([name, lock]) => [
              name,
              {
                requested: lock.resolved,
                resolved: lock.resolved,
                integrity: 'sha256-x',
                ...(lock.enabled === false ? { enabled: false } : {}),
              },
            ]),
          ),
        },
      ],
    }),
    'utf8',
  );
}

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('resolvePackageVersion', () => {
  it('resolves exact, semver range, and tag references', async () => {
    const paths = await setup();
    const file = packageFile({
      frontend: {
        tags: { latest: '1.2.0' },
        versions: {
          '1.0.0': { skills: { pdf: '1.0.0' } },
          '1.1.0': { skills: { pdf: '1.0.0' } },
          '1.2.0': { skills: { pdf: '1.0.0' } },
        },
      },
    });

    expect(resolvePackageVersion(file, 'frontend', '1.0.0')).toMatchObject({
      version: '1.0.0',
    });
    expect(resolvePackageVersion(file, 'frontend', '^1.0.0')).toMatchObject({
      version: '1.2.0',
    });
    expect(resolvePackageVersion(file, 'frontend', 'latest')).toMatchObject({
      version: '1.2.0',
    });
    expect(
      errorCode(() => resolvePackageVersion(file, 'missing', '1.0.0')),
    ).toBe('PACKAGE_NOT_FOUND');
    expect(
      errorCode(() => resolvePackageVersion(file, 'frontend', '9.9.9')),
    ).toBe('VERSION_NOT_FOUND');

    await seedSkills(paths, { pdf: ['1.0.0'] });
  });
});

describe('createPackageVersion', () => {
  it('creates skill-only, package-only, and mixed versions', async () => {
    const paths = await setup();
    await seedSkills(paths, {
      pdf: ['1.0.0'],
      review: ['1.0.0'],
    });

    const base = await createPackageVersion({
      paths,
      name: 'base',
      version: '1.0.0',
      skills: { review: '1.0.0' },
    });
    expect(base.skills).toEqual({ review: '1.0.0' });

    const skillOnly = await createPackageVersion({
      paths,
      name: 'pdf-pack',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });
    expect(skillOnly).toMatchObject({
      packages: {},
      skills: { pdf: '1.0.0' },
    });

    const mixed = await createPackageVersion({
      paths,
      name: 'frontend',
      version: '1.0.0',
      packages: { base: '1.0.0' },
      skills: { pdf: '1.0.0' },
    });
    expect(mixed).toEqual({
      packages: { base: '1.0.0' },
      skills: { pdf: '1.0.0' },
    });

    const file = await readPackageFile(paths);
    expect(file.packages.frontend?.versions['1.0.0']).toEqual(mixed);
  });

  it('rejects a package version with no dependencies', async () => {
    const paths = await setup();
    await seedSkills(paths, {});

    await expect(
      createPackageVersion({
        paths,
        name: 'empty',
        version: '1.0.0',
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_EMPTY' });
  });

  it('rejects missing skill and package references', async () => {
    const paths = await setup();
    await seedSkills(paths, { pdf: ['1.0.0'] });

    await expect(
      createPackageVersion({
        paths,
        name: 'bad-skill',
        version: '1.0.0',
        skills: { ghost: '1.0.0' },
      }),
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });

    await expect(
      createPackageVersion({
        paths,
        name: 'bad-package',
        version: '1.0.0',
        packages: { ghost: '1.0.0' },
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND' });
  });

  it('rejects self-cycles and transitive skill conflicts', async () => {
    const paths = await setup();
    await seedSkills(paths, { pdf: ['1.0.0', '2.0.0'] });

    await expect(
      createPackageVersion({
        paths,
        name: 'self',
        version: '1.0.0',
        packages: { self: '1.0.0' },
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_CYCLE' });

    await createPackageVersion({
      paths,
      name: 'a',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });
    await createPackageVersion({
      paths,
      name: 'b',
      version: '1.0.0',
      skills: { pdf: '2.0.0' },
    });

    await expect(
      createPackageVersion({
        paths,
        name: 'conflict',
        version: '1.0.0',
        packages: { a: '1.0.0', b: '1.0.0' },
      }),
    ).rejects.toMatchObject({ code: 'SKILL_VERSION_CONFLICT' });
  });

  it('rejects duplicate package versions', async () => {
    const paths = await setup();
    await seedSkills(paths, { pdf: ['1.0.0'] });
    await createPackageVersion({
      paths,
      name: 'frontend',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });

    await expect(
      createPackageVersion({
        paths,
        name: 'frontend',
        version: '1.0.0',
        skills: { pdf: '1.0.0' },
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_EXISTS' });
  });

  it('creates a history snapshot before writing', async () => {
    const paths = await setup();
    await seedSkills(paths, { pdf: ['1.0.0'] });

    await createPackageVersion({
      paths,
      name: 'frontend',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });

    const history = await listHistory(paths);
    expect(history.length).toBeGreaterThan(0);
  });
});

describe('copyPackageVersion', () => {
  async function seedFrontend(paths: SkillinkPaths): Promise<void> {
    await seedSkills(paths, {
      pdf: ['1.2.0', '1.3.0'],
      review: ['1.0.0'],
      docs: ['1.0.0'],
    });
    await createPackageVersion({
      paths,
      name: 'base',
      version: '1.0.0',
      skills: { review: '1.0.0' },
    });
    await createPackageVersion({
      paths,
      name: 'base',
      version: '2.0.0',
      skills: { docs: '1.0.0' },
    });
    await createPackageVersion({
      paths,
      name: 'frontend',
      version: '1.0.0',
      packages: { base: '1.0.0' },
      skills: { pdf: '1.2.0', review: '1.0.0' },
    });
  }

  it('copies direct dependencies without overrides', async () => {
    const paths = await setup();
    await seedFrontend(paths);

    const copied = await copyPackageVersion({
      paths,
      sourceName: 'frontend',
      sourceVersion: '1.0.0',
      targetName: 'frontend',
      targetVersion: '1.1.0',
    });

    expect(copied).toEqual({
      packages: { base: '1.0.0' },
      skills: { pdf: '1.2.0', review: '1.0.0' },
    });
  });

  it('applies skill overrides and package overrides', async () => {
    const paths = await setup();
    await seedFrontend(paths);

    const copied = await copyPackageVersion({
      paths,
      sourceName: 'frontend',
      sourceVersion: '1.0.0',
      targetName: 'frontend',
      targetVersion: '1.1.0',
      skillOverrides: { pdf: '1.3.0' },
      packageOverrides: { base: '2.0.0' },
    });

    expect(copied).toEqual({
      packages: { base: '2.0.0' },
      skills: { pdf: '1.3.0', review: '1.0.0' },
    });
  });

  it('drops direct skills and packages', async () => {
    const paths = await setup();
    await seedFrontend(paths);

    const droppedSkill = await copyPackageVersion({
      paths,
      sourceName: 'frontend',
      sourceVersion: '1.0.0',
      targetName: 'frontend',
      targetVersion: '1.1.0',
      dropSkills: ['pdf'],
    });
    expect(droppedSkill.skills).toEqual({ review: '1.0.0' });
    expect(droppedSkill.packages).toEqual({ base: '1.0.0' });

    const droppedPackage = await copyPackageVersion({
      paths,
      sourceName: 'frontend',
      sourceVersion: '1.0.0',
      targetName: 'frontend',
      targetVersion: '1.2.0',
      dropPackages: ['base'],
    });
    expect(droppedPackage.packages).toEqual({});
    expect(droppedPackage.skills).toEqual({
      pdf: '1.2.0',
      review: '1.0.0',
    });
  });

  it('inherits the source description and rejects existing targets', async () => {
    const paths = await setup();
    await seedFrontend(paths);

    await copyPackageVersion({
      paths,
      sourceName: 'frontend',
      sourceVersion: '1.0.0',
      targetName: 'frontend',
      targetVersion: '1.1.0',
      description: 'Copied frontend',
    });

    const file = await readPackageFile(paths);
    expect(file.packages.frontend?.description).toBe('Copied frontend');

    await expect(
      copyPackageVersion({
        paths,
        sourceName: 'frontend',
        sourceVersion: '1.0.0',
        targetName: 'frontend',
        targetVersion: '1.1.0',
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_EXISTS' });
    await expect(
      copyPackageVersion({
        paths,
        sourceName: 'missing',
        sourceVersion: '1.0.0',
        targetName: 'missing',
        targetVersion: '1.0.0',
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND' });
  });
});

describe('setPackageTag', () => {
  it('tags an existing version and rejects invalid graphs', async () => {
    const paths = await setup();
    await seedSkills(paths, { pdf: ['1.0.0'] });
    await createPackageVersion({
      paths,
      name: 'frontend',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });

    await setPackageTag(paths, 'frontend', '1.0.0', 'latest');

    const file = await readPackageFile(paths);
    expect(file.packages.frontend?.tags?.latest).toBe('1.0.0');
    await expect(
      setPackageTag(paths, 'frontend', '9.9.9', 'latest'),
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
    await expect(
      setPackageTag(paths, 'missing', '1.0.0', 'latest'),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND' });

    await writePackageFile(
      paths,
      packageFile({
        a: { versions: { '1.0.0': { packages: { b: '1.0.0' } } } },
        b: { versions: { '1.0.0': { packages: { a: '1.0.0' } } } },
      }),
    );
    await expect(
      setPackageTag(paths, 'a', '1.0.0', 'latest'),
    ).rejects.toMatchObject({ code: 'PACKAGE_CYCLE' });
  });
});

describe('removePackageVersion', () => {
  it('refuses to remove a version referenced by any route', async () => {
    const paths = await setup();
    await seedSkills(paths, { pdf: ['1.0.0'] });
    await createPackageVersion({
      paths,
      name: 'frontend',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });
    await seedRoute(paths, { frontend: { resolved: '1.0.0', enabled: false } });

    await expect(
      removePackageVersion(paths, 'frontend', '1.0.0'),
    ).rejects.toMatchObject({ code: 'VERSION_IN_USE' });
  });

  it('refuses to remove a version referenced by another package', async () => {
    const paths = await setup();
    await seedSkills(paths, { pdf: ['1.0.0'] });
    await createPackageVersion({
      paths,
      name: 'base',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });
    await createPackageVersion({
      paths,
      name: 'frontend',
      version: '1.0.0',
      packages: { base: '1.0.0' },
    });

    await expect(
      removePackageVersion(paths, 'base', '1.0.0'),
    ).rejects.toMatchObject({ code: 'PACKAGE_IN_USE' });
  });

  it('removes an unreferenced version and cleans tags', async () => {
    const paths = await setup();
    await seedSkills(paths, { pdf: ['1.0.0'] });
    await createPackageVersion({
      paths,
      name: 'frontend',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });
    await createPackageVersion({
      paths,
      name: 'frontend',
      version: '1.1.0',
      skills: { pdf: '1.0.0' },
    });
    await setPackageTag(paths, 'frontend', '1.0.0', 'stable');
    await setPackageTag(paths, 'frontend', '1.1.0', 'latest');

    await removePackageVersion(paths, 'frontend', '1.0.0');

    const file = await readPackageFile(paths);
    expect(file.packages.frontend?.versions['1.0.0']).toBeUndefined();
    expect(file.packages.frontend?.tags?.stable).toBeUndefined();
    expect(file.packages.frontend?.tags?.latest).toBe('1.1.0');
  });

  it('removes the package entry when the last version is removed', async () => {
    const paths = await setup();
    await seedSkills(paths, { pdf: ['1.0.0'] });
    await createPackageVersion({
      paths,
      name: 'frontend',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });

    await removePackageVersion(paths, 'frontend', '1.0.0');

    expect((await readPackageFile(paths)).packages.frontend).toBeUndefined();
  });
});
