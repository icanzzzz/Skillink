import {
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
  type PackageFile,
  type SkillinkPaths,
} from '@skillink/shared';
import { apply } from './apply.js';
import { doctor } from './doctor/index.js';
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
  writeRouteFile,
} from './route.js';
import { removeSkillVersion } from './skill-store.js';
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
  const source = await tempDir(`skillink-doctor-source-${name}-${version}-`);
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
  const root = await tempDir('skillink-doctor-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'project', 'skills');
  await mkdir(targetPath, { recursive: true });
  const paths = getSkillinkPaths(home);

  await importSkillVersion(home, 'pdf', '1.0.0');
  await importSkillVersion(home, 'review', '1.0.0');
  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.0.0',
    skills: { pdf: '1.0.0', review: '1.0.0' },
  });
  await addTarget({
    paths,
    id: 'project-a',
    path: targetPath,
    mode: 'link',
  });
  await addRouteEntry({
    paths,
    targetId: 'project-a',
    name: 'frontend',
    requested: '1.0.0',
  });

  return { paths, targetPath };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('doctor', () => {
  it('reports a healthy setup', async () => {
    const { paths } = await setup();
    await apply({ paths });

    const report = await doctor({ paths });

    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('does not report nested packages as unused', async () => {
    const { paths } = await setup();
    await createPackageVersion({
      paths,
      name: 'base',
      version: '1.0.0',
      skills: { review: '1.0.0' },
    });
    await createPackageVersion({
      paths,
      name: 'nested',
      version: '1.0.0',
      packages: { base: '1.0.0' },
      skills: { pdf: '1.0.0' },
    });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'nested',
      requested: '1.0.0',
    });
    await apply({ paths });

    const report = await doctor({ paths });

    expect(
      report.issues.filter((issue) => issue.code === 'UNUSED_PACKAGE_VERSION'),
    ).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('reports an unsafe target path', async () => {
    const { paths } = await setup();
    const route = await readRouteFile(paths);
    route.targets[0]!.path = path.parse(paths.home).root;
    await writeRouteFile(paths, route);

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNSAFE_PATH',
          targetId: 'project-a',
        }),
      ]),
    );
  });

  it('reports missing skill content', async () => {
    const { paths } = await setup();
    await rm(getSkillDir(paths, 'pdf', '1.0.0'), {
      recursive: true,
      force: true,
    });

    const report = await doctor({ paths });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_CONTENT', name: 'pdf' }),
      ]),
    );
  });

  it('reports orphan skill content', async () => {
    const { paths } = await setup();
    await mkdir(path.join(paths.libraryDir, 'orphan', '1.0.0'), {
      recursive: true,
    });

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ORPHAN_CONTENT', name: 'orphan' }),
      ]),
    );
  });

  it('reports a missing SKILL.md', async () => {
    const { paths } = await setup();
    await rm(path.join(getSkillDir(paths, 'pdf', '1.0.0'), 'SKILL.md'));

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SKILL_MD_MISSING', name: 'pdf' }),
      ]),
    );
  });

  it('reports skill content that no longer matches skill.json', async () => {
    const { paths } = await setup();
    await writeFile(
      path.join(getSkillDir(paths, 'pdf', '1.0.0'), 'content.txt'),
      'tampered',
      'utf8',
    );

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SKILL_INTEGRITY_MISMATCH',
          name: 'pdf',
          version: '1.0.0',
        }),
      ]),
    );
  });

  it('does not report an empty removed skill directory as orphan', async () => {
    const { paths } = await setup();
    await importSkillVersion(paths.home, 'temp', '1.0.0');
    await removeSkillVersion(paths, 'temp', '1.0.0');

    const report = await doctor({ paths });

    expect(
      report.issues.filter(
        (issue) => issue.code === 'ORPHAN_CONTENT' && issue.name === 'temp',
      ),
    ).toEqual([]);
  });

  it('does not report a copy target as unsupported', async () => {
    const { paths } = await setup();
    const route = await readRouteFile(paths);
    route.targets[0]!.mode = 'copy';
    await writeRouteFile(paths, route);
    await apply({ paths });

    const report = await doctor({ paths });

    expect(
      report.issues.filter((issue) => issue.code === 'UNSUPPORTED_MODE'),
    ).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('reports names that collide case-insensitively', async () => {
    const { paths } = await setup();
    await writePackageFile(paths, {
      schemaVersion: 2,
      packages: {
        Demo: {
          versions: {
            '1.0.0': { packages: {}, skills: { pdf: '1.0.0' } },
          },
        },
        demo: {
          versions: {
            '1.0.0': { packages: {}, skills: { pdf: '1.0.0' } },
          },
        },
      },
    });

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'INVALID_CONFIG',
          message: expect.stringMatching(/case-insensitive/i),
        }),
      ]),
    );
  });

  it('reports a package that references a missing skill', async () => {
    const { paths } = await setup();
    const packageFile: PackageFile = {
      schemaVersion: 2,
      packages: {
        frontend: {
          versions: {
            '1.0.0': { packages: {}, skills: { ghost: '1.0.0' } },
          },
        },
      },
    };
    await writePackageFile(paths, packageFile);

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SKILL_NOT_FOUND',
          name: 'ghost',
          packageName: 'frontend',
        }),
      ]),
    );
  });

  it('reports a route package version missing from package.json', async () => {
    const { paths } = await setup();
    const route = await readRouteFile(paths);
    route.targets[0]!.packages.ghost = {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: 'sha256-ghost',
      enabled: true,
    };
    await writeRouteFile(paths, route);

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ROUTE_MISSING_VERSION',
          name: 'ghost',
        }),
      ]),
    );
  });

  it('reports a route integrity mismatch', async () => {
    const { paths } = await setup();
    const route = await readRouteFile(paths);
    route.targets[0]!.packages.frontend!.integrity = 'sha256-wrong';
    await writeRouteFile(paths, route);

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_INTEGRITY_MISMATCH',
          name: 'frontend',
        }),
      ]),
    );
  });

  it('reports a package graph cycle', async () => {
    const { paths } = await setup();
    const packageFile: PackageFile = {
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
    await writePackageFile(paths, packageFile);

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PACKAGE_CYCLE' }),
      ]),
    );
  });

  it('reports a skill version conflict inside a target', async () => {
    const { paths } = await setup();
    await importSkillVersion(paths.home, 'pdf', '1.1.0');
    await createPackageVersion({
      paths,
      name: 'pdf-old',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });
    await createPackageVersion({
      paths,
      name: 'pdf-new',
      version: '1.0.0',
      skills: { pdf: '1.1.0' },
    });
    const packageFile = await readPackageFile(paths);
    const route = await readRouteFile(paths);
    const target = route.targets[0]!;
    target.packages = {
      'pdf-old': {
        requested: '1.0.0',
        resolved: '1.0.0',
        integrity: computePackageIntegrity(packageFile, [
          { name: 'pdf-old', version: '1.0.0' },
        ]),
        enabled: true,
      },
      'pdf-new': {
        requested: '1.0.0',
        resolved: '1.0.0',
        integrity: computePackageIntegrity(packageFile, [
          { name: 'pdf-new', version: '1.0.0' },
        ]),
        enabled: true,
      },
    };
    await writeRouteFile(paths, route);

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SKILL_VERSION_CONFLICT',
          targetId: 'project-a',
        }),
      ]),
    );
  });

  it('reports an unused package version', async () => {
    const { paths } = await setup();
    await createPackageVersion({
      paths,
      name: 'unused',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNUSED_PACKAGE_VERSION',
          name: 'unused',
        }),
      ]),
    );
  });

  it('reports link issues from status', async () => {
    const { paths, targetPath } = await setup();
    await apply({ paths });
    await rm(path.join(targetPath, 'pdf'));

    const report = await doctor({ paths });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'LINK_ISSUE',
          name: 'pdf',
          targetId: 'project-a',
        }),
      ]),
    );
  });

  it('ignores the skills repository metadata', async () => {
    const { paths } = await setup();
    await mkdir(path.join(paths.libraryDir, '.git', 'objects'), {
      recursive: true,
    });
    await writeFile(
      path.join(paths.libraryDir, '.gitattributes'),
      '* -text\n',
      'utf8',
    );

    const report = await doctor({ paths });

    expect(report.issues.some((issue) => issue.name === '.git')).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'ORPHAN_CONTENT')).toBe(
      false,
    );
  });

  it('reports every stale route lock', async () => {
    const { paths } = await setup();
    await createPackageVersion({
      paths,
      name: 'docs',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
    });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'docs',
      requested: '1.0.0',
    });
    const route = await readRouteFile(paths);
    route.targets[0]!.packages.frontend!.integrity = 'sha256-wrong';
    route.targets[0]!.packages.docs!.integrity = 'sha256-wrong';
    await writeRouteFile(paths, route);

    const report = await doctor({ paths });
    const stale = report.issues.filter(
      (issue) => issue.code === 'PACKAGE_INTEGRITY_MISMATCH',
    );

    expect(stale.map((issue) => issue.name).sort()).toEqual([
      'docs',
      'frontend',
    ]);
  });

  it('uses a provided status report instead of rescanning targets', async () => {
    const { paths } = await setup();

    const report = await doctor({
      paths,
      statusReport: {
        healthy: false,
        entries: [
          {
            targetId: 'project-a',
            targetPath: paths.home,
            name: 'fake-skill',
            version: '1.0.0',
            state: 'missing',
            path: paths.home,
          },
        ],
      },
    });

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'LINK_ISSUE', name: 'fake-skill' }),
    );
  });
});
