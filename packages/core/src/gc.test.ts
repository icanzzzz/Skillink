import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSkillDir,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import { doctor } from './doctor.js';
import { gc, planGc } from './gc.js';
import { importSkill } from './import-skill.js';
import { createPackageVersion, readPackageFile } from './package-store.js';
import {
  addRouteEntry,
  readRouteFile,
  writeRouteFile,
} from './route.js';
import { readSkillFile, setSkillTag } from './skill-store.js';
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
  const source = await tempDir(`skillink-gc-source-${name}-${version}-`);
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
  const root = await tempDir('skillink-gc-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'project', 'skills');
  await mkdir(targetPath, { recursive: true });
  const paths = getSkillinkPaths(home);

  await importSkillVersion(home, 'pdf', '1.0.0');
  await importSkillVersion(home, 'pdf', '1.1.0');
  await importSkillVersion(home, 'review', '1.0.0');

  await createPackageVersion({
    paths,
    name: 'frontend',
    version: '1.0.0',
    skills: { pdf: '1.0.0', review: '1.0.0' },
  });
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
  });
  await addTarget({
    paths,
    id: 'project-a',
    path: targetPath,
    mode: 'link',
  });

  return { paths, targetPath };
}

function candidateNames(report: { candidates: Array<{ name: string; version: string }> }): string[] {
  return report.candidates.map(
    (candidate) => `${candidate.name}@${candidate.version}`,
  );
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('garbage collection', () => {
  it('reports all unreferenced skill versions in a dry run', async () => {
    const { paths } = await setup();

    const report = await planGc(paths, { maxAgeDays: 0 });

    expect(report.dryRun).toBe(true);
    expect(candidateNames(report)).toEqual([
      'pdf@1.0.0',
      'pdf@1.1.0',
      'review@1.0.0',
    ]);
    expect(await pathExists(getSkillDir(paths, 'pdf', '1.0.0'))).toBe(true);
  });

  it('keeps skills referenced by a route package', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.0.0',
    });

    const report = await planGc(paths, { maxAgeDays: 0 });

    expect(candidateNames(report)).toEqual(['pdf@1.1.0']);
  });

  it('keeps skills referenced through nested packages', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'nested',
      requested: '1.0.0',
    });

    const report = await planGc(paths, { maxAgeDays: 0 });

    expect(candidateNames(report)).toEqual(['pdf@1.0.0', 'pdf@1.1.0']);
    expect(candidateNames(report)).not.toContain('review@1.0.0');
  });

  it('counts disabled targets and disabled package locks as references', async () => {
    const { paths } = await setup();
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'frontend',
      requested: '1.0.0',
    });

    const disabledTargetRoute = await readRouteFile(paths);
    disabledTargetRoute.targets[0]!.enabled = false;
    await writeRouteFile(paths, disabledTargetRoute);

    const disabledTargetReport = await planGc(paths, { maxAgeDays: 0 });
    expect(candidateNames(disabledTargetReport)).toEqual(['pdf@1.1.0']);

    const disabledLockRoute = await readRouteFile(paths);
    disabledLockRoute.targets[0]!.enabled = true;
    disabledLockRoute.targets[0]!.packages.frontend!.enabled = false;
    await writeRouteFile(paths, disabledLockRoute);

    const disabledLockReport = await planGc(paths, { maxAgeDays: 0 });
    expect(candidateNames(disabledLockReport)).toEqual(['pdf@1.1.0']);
  });

  it('keeps tagged skill versions when keepTagged is true', async () => {
    const { paths } = await setup();
    await setSkillTag(paths, 'pdf', '1.0.0', 'latest');

    const taggedOnly = await planGc(paths, { maxAgeDays: 0 });
    expect(candidateNames(taggedOnly)).toEqual(['pdf@1.1.0', 'review@1.0.0']);

    const all = await planGc(paths, { maxAgeDays: 0, keepTagged: false });
    expect(candidateNames(all)).toEqual([
      'pdf@1.0.0',
      'pdf@1.1.0',
      'review@1.0.0',
    ]);
  });

  it('collects skills referenced only by unused packages and doctor reports the dangling package', async () => {
    const { paths } = await setup();

    const plan = await planGc(paths, { maxAgeDays: 0 });
    expect(candidateNames(plan)).toContain('pdf@1.0.0');

    await gc(paths, { dryRun: false, maxAgeDays: 0 });

    const report = await doctor({ paths });
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SKILL_NOT_FOUND',
          packageName: 'frontend',
        }),
      ]),
    );
  });

  it('respects maxAgeDays for recent skill versions', async () => {
    const { paths } = await setup();

    expect(candidateNames(await planGc(paths, { maxAgeDays: 7 }))).toEqual([]);
  });

  it('deletes collected skills and updates skill.json', async () => {
    const { paths } = await setup();

    const report = await gc(paths, { dryRun: false, maxAgeDays: 0 });

    expect(report.dryRun).toBe(false);
    expect(report.removed).toHaveLength(3);
    expect(report.freedBytes).toBeGreaterThan(0);
    expect(await pathExists(getSkillDir(paths, 'pdf', '1.0.0'))).toBe(false);
    expect(await pathExists(path.join(paths.libraryDir, 'pdf'))).toBe(false);
    expect(await pathExists(path.join(paths.libraryDir, 'review'))).toBe(false);
    expect((await readSkillFile(paths)).skills).toEqual({});
    expect((await readPackageFile(paths)).packages.frontend).toBeDefined();
  });
});
