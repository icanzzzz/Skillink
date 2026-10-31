import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSkillDir,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import { apply } from './apply.js';
import { checkPackageSkillReferences } from './package-check.js';
import { createPackageVersion } from './package-store.js';
import { addRouteEntry } from './route.js';
import { importSkill } from './import-skill.js';
import { readSkillFile, writeSkillFile } from './skill-store.js';
import { addTarget } from './target.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function importSkillVersion(
  home: string,
  name: string,
  version: string,
): Promise<void> {
  const source = await tempDir(`skillink-check-source-${name}-${version}-`);
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
  const root = await tempDir('skillink-check-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'project', 'skills');
  await mkdir(targetPath, { recursive: true });
  const paths = getSkillinkPaths(home);

  await importSkillVersion(home, 'pdf', '1.0.0');
  await importSkillVersion(home, 'review', '1.0.0');
  await createPackageVersion({
    paths,
    name: 'demo',
    version: '1.0.0',
    skills: { pdf: '1.0.0' },
  });
  await addTarget({ paths, id: 'project-a', path: targetPath });
  await addRouteEntry({
    paths,
    targetId: 'project-a',
    name: 'demo',
    requested: '1.0.0',
  });
  await apply({ paths });

  return { paths, targetPath };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('checkPackageSkillReferences', () => {
  it('removes target skills when the referenced content is missing', async () => {
    const { paths, targetPath } = await setup();

    await rm(getSkillDir(paths, 'pdf', '1.0.0'), {
      recursive: true,
      force: true,
    });

    const report = await checkPackageSkillReferences(paths);

    expect(report.brokenReferences).toEqual([
      {
        packageName: 'demo',
        packageVersion: '1.0.0',
        skillName: 'pdf',
        skillVersion: '1.0.0',
      },
    ]);
    expect(report.targets).toEqual([
      {
        targetId: 'project-a',
        skillNames: ['pdf'],
        removed: ['pdf'],
      },
    ]);
    expect(report.failures).toEqual([]);
    expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(false);
  });

  it('finds missing catalog entries through nested packages', async () => {
    const root = await tempDir('skillink-check-nested-');
    const home = path.join(root, 'home');
    const targetPath = path.join(root, 'project', 'skills');
    await mkdir(targetPath, { recursive: true });
    const paths = getSkillinkPaths(home);

    await importSkillVersion(home, 'pdf', '1.0.0');
    await importSkillVersion(home, 'review', '1.0.0');
    await createPackageVersion({
      paths,
      name: 'base',
      version: '1.0.0',
      skills: { review: '1.0.0' },
    });
    await createPackageVersion({
      paths,
      name: 'demo',
      version: '1.0.0',
      skills: { pdf: '1.0.0' },
      packages: { base: '1.0.0' },
    });
    await addTarget({ paths, id: 'project-a', path: targetPath });
    await addRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'demo',
      requested: '1.0.0',
    });
    await apply({ paths });

    const skillFile = await readSkillFile(paths);
    delete skillFile.skills.review;
    await writeSkillFile(paths, skillFile);

    const report = await checkPackageSkillReferences(paths);

    expect(report.brokenReferences).toEqual([
      {
        packageName: 'base',
        packageVersion: '1.0.0',
        skillName: 'review',
        skillVersion: '1.0.0',
      },
    ]);
    expect(report.targets).toEqual([
      {
        targetId: 'project-a',
        skillNames: ['review'],
        removed: ['review'],
      },
    ]);
    expect(await pathExists(path.join(targetPath, 'review'))).toBe(false);
    expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(true);
  });

  it('does nothing when all package skill references resolve', async () => {
    const { paths, targetPath } = await setup();

    const report = await checkPackageSkillReferences(paths);

    expect(report.brokenReferences).toEqual([]);
    expect(report.targets).toEqual([]);
    expect(report.failures).toEqual([]);
    expect(await pathExists(path.join(targetPath, 'pdf'))).toBe(true);
  });
});
