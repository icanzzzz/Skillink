import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths, type SkillinkPaths } from '@skillink/shared';
import { importSkill } from './import-skill.js';
import { computePackageIntegrity } from './package-graph.js';
import {
  createPackageVersion,
  readPackageFile,
} from './package-store.js';
import { addRouteEntry, readRouteFile, writeRouteFile } from './route.js';
import { summarizeTargetSkills } from './target-resolution.js';
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
  const source = await tempDir(`skillink-summary-source-${name}-${version}-`);
  await writeFile(path.join(source, 'SKILL.md'), `# ${name} ${version}`, 'utf8');
  await importSkill({ sourceDir: source, name, version, home });
}

async function setup(): Promise<{ paths: SkillinkPaths; targetPath: string }> {
  const root = await tempDir('skillink-summary-');
  const home = path.join(root, 'home');
  const targetPath = path.join(root, 'target');
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
  await addTarget({ paths, id: 'project-a', path: targetPath, mode: 'link' });
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

describe('summarizeTargetSkills', () => {
  it('resolves the skills for a target', async () => {
    const { paths } = await setup();

    await expect(summarizeTargetSkills({ paths })).resolves.toEqual([
      {
        targetId: 'project-a',
        skills: [
          { name: 'pdf', version: '1.0.0' },
          { name: 'review', version: '1.0.0' },
        ],
      },
    ]);
  });

  it('excludes disabled package locks', async () => {
    const { paths } = await setup();
    const route = await readRouteFile(paths);
    route.targets[0]!.packages.frontend!.enabled = false;
    await writeRouteFile(paths, route);

    await expect(summarizeTargetSkills({ paths })).resolves.toEqual([
      { targetId: 'project-a', skills: [] },
    ]);
  });

  it('reports stale route lock integrity', async () => {
    const { paths } = await setup();
    const route = await readRouteFile(paths);
    route.targets[0]!.packages.frontend!.integrity = 'sha256-stale';
    await writeRouteFile(paths, route);

    const result = await summarizeTargetSkills({ paths });

    expect(result[0]?.skills).toEqual([]);
    expect(result[0]?.error).toContain('PACKAGE_INTEGRITY_MISMATCH');
  });

  it('reports resolution errors instead of throwing', async () => {
    const { paths } = await setup();
    await importSkillVersion(paths.home, 'pdf', '2.0.0');
    await createPackageVersion({
      paths,
      name: 'docs',
      version: '1.0.0',
      skills: { pdf: '2.0.0' },
    });
    const packageFile = await readPackageFile(paths);
    const route = await readRouteFile(paths);
    route.targets[0]!.packages.docs = {
      requested: '1.0.0',
      resolved: '1.0.0',
      integrity: computePackageIntegrity(packageFile, [
        { name: 'docs', version: '1.0.0' },
      ]),
      enabled: true,
    };
    await writeRouteFile(paths, route);

    const result = await summarizeTargetSkills({ paths });

    expect(result[0]?.skills).toEqual([]);
    expect(result[0]?.error).toContain('SKILL_VERSION_CONFLICT');
  });
});
