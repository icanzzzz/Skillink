import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { getSkillinkPaths } from '@skillink/shared';
import {
  ensureControlRepo,
  ensureSkillsRepo,
  gitAddAll,
  gitCheckoutPaths,
  gitCommit,
  gitHead,
  gitLog,
  gitPathHistory,
  gitResolveCommit,
  gitShowFile,
  gitShowJson,
  gitStagedFiles,
  gitStatus,
  isGitAvailable,
} from './git.js';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skillink-git-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(!(await isGitAvailable()))('git module', () => {
  it('detects git on PATH', async () => {
    expect(await isGitAvailable()).toBe(true);
  });

  it('creates the control repo with ignore and attribute files', async () => {
    const paths = getSkillinkPaths(await tempHome());

    await ensureControlRepo(paths);

    const gitignore = await readFile(
      path.join(paths.home, '.gitignore'),
      'utf8',
    );
    expect(gitignore.split(/\r?\n/)).toEqual(
      expect.arrayContaining([
        '/skills/',
        '/trash/',
        '/history/',
        '/cache/',
        '/logs/',
        '/tmp/',
        '/settings.json',
        '.skillink.lock',
      ]),
    );

    const attributes = await readFile(
      path.join(paths.home, '.gitattributes'),
      'utf8',
    );
    expect(attributes.split(/\r?\n/)).toContain('* -text');
    await expect(
      gitStatus(paths, 'control').then(() => gitHead(paths, 'control')),
    ).resolves.toBeUndefined();
  });

  it('does not overwrite existing ignore entries', async () => {
    const paths = getSkillinkPaths(await tempHome());
    await ensureControlRepo(paths);
    const gitignorePath = path.join(paths.home, '.gitignore');
    const existing = `# keep me\n/custom/\n${await readFile(gitignorePath, 'utf8')}`;
    await writeFile(gitignorePath, existing, 'utf8');

    await ensureControlRepo(paths);

    const next = await readFile(gitignorePath, 'utf8');
    expect(next).toContain('# keep me');
    expect(next).toContain('/custom/');
    expect(next.match(/\/skills\//g)).toHaveLength(1);
  });

  it('creates the skills repo with its own attributes file', async () => {
    const paths = getSkillinkPaths(await tempHome());

    await ensureSkillsRepo(paths);

    const attributes = await readFile(
      path.join(paths.libraryDir, '.gitattributes'),
      'utf8',
    );
    expect(attributes.split(/\r?\n/)).toContain('* -text');
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      { cwd: paths.libraryDir },
    );
    expect(stdout.trim()).toBe('true');
  });

  it('rejects git commands outside a repository', async () => {
    const paths = getSkillinkPaths(await tempHome());

    await expect(gitStatus(paths, 'control')).rejects.toMatchObject({
      code: 'GIT_NOT_REPOSITORY',
    });
  });

  it('commits, reads history, and restores files', async () => {
    const paths = getSkillinkPaths(await tempHome());
    await ensureControlRepo(paths);
    await writeFile(
      paths.routeFile,
      JSON.stringify({ schemaVersion: 2, targets: [] }),
      'utf8',
    );

    expect(await gitStatus(paths, 'control')).not.toHaveLength(0);
    await gitAddAll(paths, 'control');
    expect(await gitStagedFiles(paths, 'control')).toEqual(
      expect.arrayContaining(['route.json', '.gitignore', '.gitattributes']),
    );

    const head = await gitCommit(
      paths,
      'control',
      'skillink(init): initialize control plane',
    );
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(await gitHead(paths, 'control')).toBe(head);
    expect(await gitStatus(paths, 'control')).toEqual([]);

    const log = await gitLog(paths, 'control');
    expect(log).toEqual([
      expect.objectContaining({
        id: head,
        reason: 'skillink(init): initialize control plane',
      }),
    ]);
    expect(Date.parse(log[0]!.createdAt)).not.toBeNaN();

    expect(await gitResolveCommit(paths, 'control', 'HEAD')).toBe(head);
    expect(
      await gitShowFile(paths, 'control', head, 'route.json'),
    ).toContain('"schemaVersion":2');
    expect(
      await gitShowJson(paths, 'control', head, 'route.json'),
    ).toEqual({ schemaVersion: 2, targets: [] });

    await writeFile(paths.routeFile, '{"schemaVersion":2,"targets":[1]}', 'utf8');
    await gitCheckoutPaths(paths, 'control', head, ['route.json']);
    expect(await readFile(paths.routeFile, 'utf8')).toContain('"targets":[]');
  });

  it('uses the Skillink identity and ignores hooks', async () => {
    const paths = getSkillinkPaths(await tempHome());
    await ensureControlRepo(paths);
    await writeFile(paths.routeFile, '{}', 'utf8');
    await gitAddAll(paths, 'control');
    await gitCommit(paths, 'control', 'skillink(init): initialize control plane');

    const { stdout } = await execFileAsync(
      'git',
      ['log', '-1', '--format=%an <%ae>'],
      { cwd: paths.home },
    );
    expect(stdout.trim()).toBe('Skillink <skillink@local>');
  });

  it('keeps skills and settings out of the control repo', async () => {
    const paths = getSkillinkPaths(await tempHome());
    await ensureControlRepo(paths);
    await ensureSkillsRepo(paths);
    await writeFile(paths.settingsFile, '{}', 'utf8');
    await mkdir(path.join(paths.libraryDir, 'pdf', '1.0.0'), {
      recursive: true,
    });
    await writeFile(
      path.join(paths.libraryDir, 'pdf', '1.0.0', 'SKILL.md'),
      '# pdf',
      'utf8',
    );

    await gitAddAll(paths, 'control');

    const staged = await gitStagedFiles(paths, 'control');
    expect(staged).not.toContain('settings.json');
    expect(staged.some((file) => file.startsWith('skills/'))).toBe(false);
  });

  it('finds the last commit that touched a skill version', async () => {
    const paths = getSkillinkPaths(await tempHome());
    await ensureControlRepo(paths);
    await ensureSkillsRepo(paths);
    const skillFile = path.join(paths.libraryDir, 'pdf', '1.0.0', 'SKILL.md');
    await mkdir(path.dirname(skillFile), { recursive: true });
    await writeFile(skillFile, '# pdf', 'utf8');
    await gitAddAll(paths, 'skills');
    const commit = await gitCommit(paths, 'skills', 'skillink(skills): add pdf');

    expect(
      await gitPathHistory(paths, 'skills', 'pdf/1.0.0'),
    ).toBe(commit);
    expect(
      await gitPathHistory(paths, 'skills', 'unknown/1.0.0'),
    ).toBeUndefined();
  });
});
