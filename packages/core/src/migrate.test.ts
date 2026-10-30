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
  createEmptySkillFile,
  getSkillDir,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import { migrateV1ToV2 } from './migrate.js';
import { readPackageFile, resolvePackageVersion } from './package-store.js';
import { readRouteFile } from './route.js';
import { readSkillFile } from './skill-store.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setup(): Promise<SkillinkPaths> {
  const root = await tempDir('skillink-migrate-');
  return getSkillinkPaths(path.join(root, 'home'));
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function createContent(
  paths: SkillinkPaths,
  name: string,
  version: string,
  withSkillMd = true,
): Promise<void> {
  const dir = getSkillDir(paths, name, version);
  await mkdir(dir, { recursive: true });
  if (withSkillMd) {
    await writeFile(path.join(dir, 'SKILL.md'), `# ${name} ${version}`, 'utf8');
  }
  await writeFile(path.join(dir, 'content.txt'), `${name}@${version}`, 'utf8');
}

function legacyPackage(
  name: string,
  versions: string[],
  extra: {
    description?: string;
    kind?: string;
    tags?: Record<string, string>;
  } = {},
) {
  return {
    ...extra,
    versions: Object.fromEntries(
      versions.map((version) => [
        version,
        {
          integrity: `sha512-${name}-${version}`,
          source: `skills/${name}/${version}`,
          fileCount: 1,
          size: 1,
          built: false,
        },
      ]),
    ),
  };
}

function legacyRoute(
  packages: Record<string, ReturnType<typeof legacyPackage>>,
  targets: Array<{
    id: string;
    path: string;
    skills: Record<
      string,
      { requested?: string; resolved: string; enabled?: boolean }
    >;
  }>,
) {
  return {
    schemaVersion: 1,
    targets: targets.map((target) => ({
      id: target.id,
      path: target.path,
      mode: 'link',
      skills: Object.fromEntries(
        Object.entries(target.skills).map(([name, lock]) => {
          const version = packages[name]?.versions[lock.resolved];
          return [
            name,
            {
              ...(lock.requested !== undefined
                ? { requested: lock.requested }
                : {}),
              resolved: lock.resolved,
              integrity: version?.integrity,
              source: version?.source,
              ...(lock.enabled === false ? { enabled: false } : {}),
            },
          ];
        }),
      ),
    })),
  };
}

async function writeLegacy(
  paths: SkillinkPaths,
  packages: Record<string, ReturnType<typeof legacyPackage>>,
  route: ReturnType<typeof legacyRoute>,
): Promise<void> {
  await mkdir(paths.home, { recursive: true });
  await writeFile(
    paths.skillsFile,
    JSON.stringify({ schemaVersion: 1, packages }, null, 2),
    'utf8',
  );
  await writeFile(paths.routeFile, JSON.stringify(route, null, 2), 'utf8');
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('migrateV1ToV2', () => {
  it('migrates a package, a skill, and a route target', async () => {
    const paths = await setup();
    const packages = { demo: legacyPackage('demo', ['1.0.0']) };
    await createContent(paths, 'demo', '1.0.0');
    await writeLegacy(
      paths,
      packages,
      legacyRoute(packages, [
        {
          id: 'project-a',
          path: 'C:/tmp/project-a',
          skills: { demo: { requested: '1.0.0', resolved: '1.0.0' } },
        },
      ]),
    );

    const result = await migrateV1ToV2(paths);

    expect(result).toEqual({
      migrated: true,
      skillCount: 1,
      packageCount: 1,
      targetCount: 1,
    });

    const skillFile = await readSkillFile(paths);
    expect(skillFile.skills.demo?.versions['1.0.0']).toMatchObject({
      integrity: 'sha512-demo-1.0.0',
      fileCount: 1,
      size: 1,
    });
    expect(skillFile.skills.demo?.versions['1.0.0']).not.toHaveProperty(
      'source',
    );

    const packageFile = await readPackageFile(paths);
    expect(
      packageFile.packages.demo?.versions['1.0.0']?.skills.demo,
    ).toBe('1.0.0');

    const route = await readRouteFile(paths);
    expect(route.targets[0]?.packages.demo?.resolved).toBe('1.0.0');
    expect(route.targets[0]?.packages.demo?.integrity).toMatch(/^sha256-/);

    expect(await pathExists(paths.skillsFile)).toBe(false);
    expect(await pathExists(paths.skillFile)).toBe(true);
    expect(await pathExists(paths.packageFile)).toBe(true);
  });

  it('preserves multiple versions and multiple skills', async () => {
    const paths = await setup();
    const packages = {
      pdf: legacyPackage('pdf', ['1.0.0', '1.1.0']),
      review: legacyPackage('review', ['2.0.0']),
    };
    await createContent(paths, 'pdf', '1.0.0');
    await createContent(paths, 'pdf', '1.1.0');
    await createContent(paths, 'review', '2.0.0');
    await writeLegacy(
      paths,
      packages,
      legacyRoute(packages, [
        {
          id: 'project-a',
          path: 'C:/tmp/project-a',
          skills: {
            pdf: { requested: '^1.0.0', resolved: '1.1.0' },
            review: { requested: '2.0.0', resolved: '2.0.0' },
          },
        },
      ]),
    );

    const result = await migrateV1ToV2(paths);

    expect(result).toMatchObject({
      migrated: true,
      skillCount: 2,
      packageCount: 2,
      targetCount: 1,
    });
    const packageFile = await readPackageFile(paths);
    expect(Object.keys(packageFile.packages.pdf!.versions)).toEqual([
      '1.0.0',
      '1.1.0',
    ]);
    const route = await readRouteFile(paths);
    expect(route.targets[0]?.packages.pdf?.resolved).toBe('1.1.0');
    expect(route.targets[0]?.packages.review?.resolved).toBe('2.0.0');
  });

  it('copies descriptions and tags to both skills and packages', async () => {
    const paths = await setup();
    const packages = {
      demo: legacyPackage('demo', ['1.0.0'], {
        description: 'Demo skill',
        kind: 'skill',
        tags: { latest: '1.0.0' },
      }),
    };
    await createContent(paths, 'demo', '1.0.0');
    await writeLegacy(
      paths,
      packages,
      legacyRoute(packages, [
        {
          id: 'project-a',
          path: 'C:/tmp/project-a',
          skills: { demo: { requested: 'latest', resolved: '1.0.0' } },
        },
      ]),
    );

    await migrateV1ToV2(paths);

    const skillFile = await readSkillFile(paths);
    const packageFile = await readPackageFile(paths);
    expect(skillFile.skills.demo?.description).toBe('Demo skill');
    expect(skillFile.skills.demo?.tags?.latest).toBe('1.0.0');
    expect(packageFile.packages.demo?.description).toBe('Demo skill');
    expect(packageFile.packages.demo?.tags?.latest).toBe('1.0.0');
    expect(resolvePackageVersion(packageFile, 'demo', 'latest').version).toBe(
      '1.0.0',
    );

    const route = await readRouteFile(paths);
    expect(route.targets[0]?.packages.demo?.requested).toBe('latest');
  });

  it('does nothing when there is no v1 skills.json', async () => {
    const paths = await setup();

    const result = await migrateV1ToV2(paths);

    expect(result.migrated).toBe(false);
    expect(await pathExists(paths.skillFile)).toBe(false);
    expect(await pathExists(paths.packageFile)).toBe(false);
  });

  it('refuses to overwrite an existing v2 skill.json', async () => {
    const paths = await setup();
    await mkdir(paths.home, { recursive: true });
    await writeFile(paths.skillsFile, '{"schemaVersion":1,"packages":{}}', 'utf8');
    await writeFile(
      paths.skillFile,
      JSON.stringify(createEmptySkillFile()),
      'utf8',
    );

    await expect(migrateV1ToV2(paths)).rejects.toMatchObject({
      code: 'PACKAGE_EXISTS',
    });
    expect(await pathExists(paths.packageFile)).toBe(false);
  });

  it('rejects a package with no versions without writing new files', async () => {
    const paths = await setup();
    const packages = { empty: legacyPackage('empty', []) };
    await writeLegacy(
      paths,
      packages,
      legacyRoute(packages, [
        { id: 'project-a', path: 'C:/tmp/project-a', skills: {} },
      ]),
    );
    const oldSkills = await readFile(paths.skillsFile, 'utf8');

    await expect(migrateV1ToV2(paths)).rejects.toThrow(/empty/);

    expect(await readFile(paths.skillsFile, 'utf8')).toBe(oldSkills);
    expect(await pathExists(paths.skillFile)).toBe(false);
    expect(await pathExists(paths.packageFile)).toBe(false);
  });

  it('rejects missing content and missing SKILL.md', async () => {
    const missingContent = await setup();
    const contentPackages = {
      demo: legacyPackage('demo', ['1.0.0']),
    };
    await writeLegacy(
      missingContent,
      contentPackages,
      legacyRoute(contentPackages, [
        { id: 'project-a', path: 'C:/tmp/project-a', skills: {} },
      ]),
    );
    await expect(migrateV1ToV2(missingContent)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });

    const missingSkillMd = await setup();
    const skillMdPackages = {
      demo: legacyPackage('demo', ['1.0.0'], { kind: 'skill' }),
    };
    await createContent(missingSkillMd, 'demo', '1.0.0', false);
    await writeLegacy(
      missingSkillMd,
      skillMdPackages,
      legacyRoute(skillMdPackages, [
        { id: 'project-a', path: 'C:/tmp/project-a', skills: {} },
      ]),
    );
    await expect(migrateV1ToV2(missingSkillMd)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });
  });

  it('rejects invalid tags and missing route references', async () => {
    const invalidTag = await setup();
    const tagPackages = {
      demo: legacyPackage('demo', ['1.0.0'], {
        tags: { latest: '9.9.9' },
      }),
    };
    await createContent(invalidTag, 'demo', '1.0.0');
    await writeLegacy(
      invalidTag,
      tagPackages,
      legacyRoute(tagPackages, [
        { id: 'project-a', path: 'C:/tmp/project-a', skills: {} },
      ]),
    );
    await expect(migrateV1ToV2(invalidTag)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });

    const missingRouteRef = await setup();
    const routePackages = {
      demo: legacyPackage('demo', ['1.0.0']),
    };
    await createContent(missingRouteRef, 'demo', '1.0.0');
    await writeLegacy(
      missingRouteRef,
      routePackages,
      legacyRoute(routePackages, [
        {
          id: 'project-a',
          path: 'C:/tmp/project-a',
          skills: { demo: { requested: '9.9.9', resolved: '9.9.9' } },
        },
      ]),
    );
    await expect(migrateV1ToV2(missingRouteRef)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });
  });

  it('leaves the old skills.json and route unchanged after a failed preflight', async () => {
    const paths = await setup();
    const packages = { demo: legacyPackage('demo', ['1.0.0']) };
    await writeLegacy(
      paths,
      packages,
      legacyRoute(packages, [
        { id: 'project-a', path: 'C:/tmp/project-a', skills: {} },
      ]),
    );
    const oldSkills = await readFile(paths.skillsFile, 'utf8');
    const oldRoute = await readFile(paths.routeFile, 'utf8');

    await expect(migrateV1ToV2(paths)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });

    expect(await readFile(paths.skillsFile, 'utf8')).toBe(oldSkills);
    expect(await readFile(paths.routeFile, 'utf8')).toBe(oldRoute);
    expect(await pathExists(paths.skillFile)).toBe(false);
    expect(await pathExists(paths.packageFile)).toBe(false);
  });
});
