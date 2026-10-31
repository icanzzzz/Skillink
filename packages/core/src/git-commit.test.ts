import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import {
  ensureControlRepo,
  ensureSkillsRepo,
  gitAddAll,
  gitCommit,
  gitHead,
  gitLog,
  gitShowFile,
  gitStagedFiles,
  gitStatus,
  isGitAvailable,
} from './git.js';
import {
  buildCommitMessage,
  commitRepoChanges,
  ensureCleanOrBootstrap,
} from './git-commit.js';

const execFileAsync = promisify(execFile);
const gitReady = await isGitAvailable();

const tempDirs: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skillink-commit-'));
  tempDirs.push(dir);
  return dir;
}

async function seededHome() {
  const paths = getSkillinkPaths(await tempHome());
  await ensureControlRepo(paths);
  await ensureSkillsRepo(paths);
  await writeFile(paths.routeFile, '{"schemaVersion":2,"targets":[]}', 'utf8');
  await writeFile(
    paths.packageFile,
    '{"schemaVersion":2,"packages":{}}',
    'utf8',
  );
  await writeFile(paths.skillFile, '{"schemaVersion":2,"skills":{}}', 'utf8');
  await gitAddAll(paths, 'control');
  await gitCommit(paths, 'control', 'skillink(init): initialize control plane');
  await gitAddAll(paths, 'skills');
  await gitCommit(paths, 'skills', 'skillink(skills): initialize skills');
  return paths;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(!gitReady)('repository commits', () => {
  it('commits a complete control plane when bootstrapping a fresh home', async () => {
    const paths = getSkillinkPaths(await tempHome());

    await ensureCleanOrBootstrap(paths);

    const head = await gitHead(paths, 'control');
    expect(head).toBeDefined();
    for (const file of ['route.json', 'package.json', 'skill.json']) {
      expect(
        await gitShowFile(paths, 'control', head!, file),
      ).toContain('"schemaVersion": 2');
    }
  });

  it('repairs and commits metadata on a clean hand-initialized repo', async () => {
    const paths = getSkillinkPaths(await tempHome());
    await mkdir(paths.home, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: paths.home });
    await writeFile(
      paths.routeFile,
      JSON.stringify({ schemaVersion: 2, targets: [] }),
      'utf8',
    );
    await writeFile(
      paths.packageFile,
      JSON.stringify({ schemaVersion: 2, packages: {} }),
      'utf8',
    );
    await writeFile(
      paths.skillFile,
      JSON.stringify({ schemaVersion: 2, skills: {} }),
      'utf8',
    );
    await execFileAsync('git', ['add', '-A'], { cwd: paths.home });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@local',
        'commit',
        '-m',
        'hand init',
      ],
      { cwd: paths.home },
    );

    await ensureCleanOrBootstrap(paths);

    expect(await gitStatus(paths, 'control')).toEqual([]);
    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(init): initialize control plane',
    );
  });

  it('ignores stray untracked files in the home', async () => {
    const paths = await seededHome();
    await writeFile(path.join(paths.home, 'notes.txt'), 'private', 'utf8');

    await expect(
      ensureCleanOrBootstrap(paths),
    ).resolves.toBeUndefined();

    await writeFile(
      paths.routeFile,
      '{"schemaVersion":2,"targets":[1]}',
      'utf8',
    );
    await commitRepoChanges({
      paths,
      repo: 'control',
      buildMessage: (changedFiles) =>
        buildCommitMessage({
          scope: 'target',
          action: 'add',
          summary: 'a',
          changedFiles,
        }),
    });

    expect(await gitStagedFiles(paths, 'control')).toEqual([]);
    const head = await gitHead(paths, 'control');
    await expect(
      gitShowFile(paths, 'control', head!, 'notes.txt'),
    ).rejects.toBeInstanceOf(Error);
  });

  it('commits only when the repository changed', async () => {
    const paths = await seededHome();
    await writeFile(paths.routeFile, '{"schemaVersion":2,"targets":[1]}', 'utf8');

    const hash = await commitRepoChanges({
      paths,
      repo: 'control',
      buildMessage: (changedFiles) =>
        buildCommitMessage({
          scope: 'target',
          action: 'add',
          summary: 'a -> C:/targets/a',
          changedFiles,
        }),
    });

    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const log = await gitLog(paths, 'control');
    expect(log[0]?.reason).toBe(
      'skillink(target): add a -> C:/targets/a',
    );
    expect(await gitStatus(paths, 'control')).toEqual([]);

    expect(
      await commitRepoChanges({
        paths,
        repo: 'control',
        buildMessage: (changedFiles) =>
          buildCommitMessage({
            scope: 'target',
            action: 'update',
            changedFiles,
          }),
      }),
    ).toBeUndefined();
    expect(await gitLog(paths, 'control')).toHaveLength(2);
  });
});
