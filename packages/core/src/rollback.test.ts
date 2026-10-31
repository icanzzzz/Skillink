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
  SkillFileSchema,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import { apply } from './apply.js';
import { doctor } from './doctor/index.js';
import {
  ensureControlRepo,
  ensureSkillsRepo,
  gitAddAll,
  gitCommit,
  gitHead,
  gitLog,
  isGitAvailable,
} from './git.js';
import { importSkill } from './import-skill.js';
import { createPackageVersion } from './package-store.js';
import { addRouteEntry, readRouteFile, removeRouteEntry, writeRouteFile } from './route.js';
import { addTarget, removeTarget } from './target.js';
import { rollbackTo } from './rollback.js';
import { withHomeLock } from './git-lock.js';
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

interface Seed {
  paths: SkillinkPaths;
  targetA: string;
  targetB: string;
  revision: string;
}

async function seed(): Promise<Seed> {
  const home = await tempDir('skillink-rollback-home-');
  const paths = getSkillinkPaths(home);
  await ensureControlRepo(paths);
  await ensureSkillsRepo(paths);

  const source = await tempDir('skillink-rollback-source-');
  await writeFile(path.join(source, 'SKILL.md'), '# demo', 'utf8');
  await importSkill({
    sourceDir: source,
    name: 'demo',
    version: '1.0.0',
    home,
  });
  await createPackageVersion({
    paths,
    name: 'bundle',
    version: '1.0.0',
    skills: { demo: '1.0.0' },
  });

  const targetA = await tempDir('skillink-rollback-target-a-');
  const targetB = await tempDir('skillink-rollback-target-b-');
  await addTarget({ paths, id: 'project-a', path: targetA });
  await addTarget({ paths, id: 'project-b', path: targetB });
  await addRouteEntry({
    paths,
    targetId: 'project-a',
    name: 'bundle',
    requested: '1.0.0',
  });
  await addRouteEntry({
    paths,
    targetId: 'project-b',
    name: 'bundle',
    requested: '1.0.0',
  });
  await apply({ paths });

  await writeFile(path.join(targetA, 'keep.txt'), 'keep', 'utf8');
  await mkdir(path.join(targetA, 'unknown-dir'), { recursive: true });
  await mkdir(path.join(targetA, '.git'), { recursive: true });

  await gitAddAll(paths, 'control');
  const revision = await gitCommit(
    paths,
    'control',
    'skillink(init): initialize control plane',
  );
  await gitAddAll(paths, 'skills');
  await gitCommit(paths, 'skills', 'skillink(skills): add demo@1.0.0');

  return { paths, targetA, targetB, revision };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(!(await isGitAvailable()))('rollback', () => {
  it('removes current targets, restores config, and re-applies in one commit', async () => {
    const { paths, targetA, targetB, revision } = await seed();

    await removeRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'bundle',
    });
    await removeTarget({ paths, id: 'project-b' });
    const targetC = await tempDir('skillink-rollback-target-c-');
    await addTarget({ paths, id: 'project-c', path: targetC });
    await addRouteEntry({
      paths,
      targetId: 'project-c',
      name: 'bundle',
      requested: '1.0.0',
    });
    await apply({ paths });
    await gitAddAll(paths, 'control');
    await gitCommit(paths, 'control', 'skillink(target): add project-c');

    const before = await gitLog(paths, 'control');

    const result = await rollbackTo({ paths, revision });

    const route = await readRouteFile(paths);
    expect(route.targets.map((target) => target.id)).toEqual([
      'project-a',
      'project-b',
    ]);
    expect(await pathExists(path.join(targetA, 'demo'))).toBe(true);
    expect(await pathExists(path.join(targetB, 'demo'))).toBe(true);
    expect(await pathExists(path.join(targetC, 'demo'))).toBe(false);
    expect(await pathExists(path.join(targetA, 'keep.txt'))).toBe(true);
    expect(await pathExists(path.join(targetA, 'unknown-dir'))).toBe(true);
    expect(await pathExists(path.join(targetA, '.git'))).toBe(true);

    const after = await gitLog(paths, 'control');
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]?.reason).toBe(
      `skillink(rollback): restore ${revision.slice(0, 7)}`,
    );
    expect(result.commit).toBe(after[0]?.id);
    expect(result.removedTargets).toEqual([
      'project-a',
      'project-c',
    ]);
  });

  it('restores missing skill content from the skills repository', async () => {
    const { paths, revision } = await seed();
    const skillDir = path.join(paths.libraryDir, 'demo', '1.0.0');
    await rm(skillDir, { recursive: true, force: true });
    await gitAddAll(paths, 'skills');
    await gitCommit(paths, 'skills', 'skillink(skills): remove demo');

    const result = await rollbackTo({ paths, revision });

    expect(await pathExists(path.join(skillDir, 'SKILL.md'))).toBe(true);
    expect(result.restoredSkills).toEqual([
      expect.objectContaining({ name: 'demo', version: '1.0.0' }),
    ]);
    expect((await gitLog(paths, 'skills'))[0]?.reason).toBe(
      `skillink(skills): restore ${revision.slice(0, 7)}`,
    );
  });

  it('reports SKILL_CONTENT_NOT_IN_GIT when content is unavailable', async () => {
    const { paths } = await seed();
    const revision = await gitHead(paths, 'control');
    await rm(path.join(paths.libraryDir, 'demo'), {
      recursive: true,
      force: true,
    });
    await rm(path.join(paths.libraryDir, '.git'), {
      recursive: true,
      force: true,
    });
    await ensureSkillsRepo(paths);
    await gitAddAll(paths, 'skills');
    await gitCommit(paths, 'skills', 'skillink(skills): reset');

    await expect(
      rollbackTo({ paths, revision: revision! }),
    ).rejects.toMatchObject({ code: 'SKILL_CONTENT_NOT_IN_GIT' });
  });

  it('restores the control plane to its starting commit on failure', async () => {
    const { paths, revision } = await seed();
    const route = await readRouteFile(paths);
    const brokenTarget = await tempDir('skillink-rollback-target-broken-');
    route.targets.push({
      id: 'broken',
      path: brokenTarget,
      mode: 'link',
      enabled: true,
      packages: {
        ghost: {
          requested: 'ghost@1.0.0',
          resolved: '1.0.0',
          integrity: 'missing',
          enabled: true,
        },
      },
    });
    await writeRouteFile(paths, route);
    await gitAddAll(paths, 'control');
    const startHead = await gitCommit(
      paths,
      'control',
      'skillink(target): add broken',
    );
    const startRoute = await readFile(paths.routeFile, 'utf8');

    await expect(rollbackTo({ paths, revision })).rejects.toBeInstanceOf(
      Error,
    );

    expect(await gitHead(paths, 'control')).toBe(startHead);
    expect(await readFile(paths.routeFile, 'utf8')).toBe(startRoute);
    expect(
      SkillFileSchema.parse(
        JSON.parse(await readFile(paths.skillFile, 'utf8')),
      ),
    ).toBeDefined();
  });

  it('supports --no-apply by restoring configuration only', async () => {
    const { paths, targetA, revision } = await seed();
    await removeRouteEntry({
      paths,
      targetId: 'project-a',
      name: 'bundle',
    });
    await gitAddAll(paths, 'control');
    await gitCommit(paths, 'control', 'skillink(route): remove project-a');

    await rollbackTo({ paths, revision, apply: false });

    const route = await readRouteFile(paths);
    expect(route.targets.map((target) => target.id)).toEqual([
      'project-a',
      'project-b',
    ]);
    expect(await pathExists(path.join(targetA, 'demo'))).toBe(false);
  });

  it('removes skill versions added after the target commit', async () => {
    const { paths, revision } = await seed();
    const source = await tempDir('skillink-rollback-source-newer-');
    await writeFile(path.join(source, 'SKILL.md'), '# demo newer', 'utf8');
    await importSkill({
      sourceDir: source,
      name: 'demo',
      version: '1.1.0',
      home: paths.home,
    });
    await gitAddAll(paths, 'control');
    await gitCommit(paths, 'control', 'skillink(skill): add demo@1.1.0');
    await gitAddAll(paths, 'skills');
    await gitCommit(paths, 'skills', 'skillink(skills): add demo@1.1.0');

    const result = await rollbackTo({ paths, revision });

    expect(result.removedSkills).toEqual([
      { name: 'demo', version: '1.1.0' },
    ]);
    expect(
      await pathExists(path.join(paths.libraryDir, 'demo', '1.1.0')),
    ).toBe(false);
    expect(
      await pathExists(path.join(paths.libraryDir, 'demo', '1.0.0')),
    ).toBe(true);
    expect((await doctor({ paths })).ok).toBe(true);
    expect((await gitLog(paths, 'skills'))[0]?.reason).toBe(
      `skillink(skills): restore ${revision.slice(0, 7)}`,
    );
  });

  it('rejects a revision that does not contain the full control plane', async () => {
    const { paths } = await seed();
    await rm(paths.skillFile);
    await gitAddAll(paths, 'control');
    const head = await gitCommit(
      paths,
      'control',
      'test: delete skill.json',
    );
    const routeBefore = await readFile(paths.routeFile, 'utf8');

    await expect(rollbackTo({ paths, revision: head })).rejects.toMatchObject({
      code: 'HISTORY_NOT_FOUND',
      message: expect.stringContaining('skill.json'),
    });
    expect(await readFile(paths.routeFile, 'utf8')).toBe(routeBefore);
  });

  it('rejects a dirty control plane before touching targets', async () => {
    const { paths, revision } = await seed();
    await writeFile(
      paths.routeFile,
      JSON.stringify({ schemaVersion: 2, targets: [] }),
      'utf8',
    );

    await expect(rollbackTo({ paths, revision })).rejects.toMatchObject({
      code: 'GIT_DIRTY',
    });
  });

  it('acquires the home lock itself', async () => {
    const { paths, revision } = await seed();

    await withHomeLock(paths, async () => {
      await expect(
        rollbackTo({
          paths,
          revision,
          lockOptions: { retryMs: 10, timeoutMs: 50, staleMs: 60_000 },
        }),
      ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });
    });
  });
});
