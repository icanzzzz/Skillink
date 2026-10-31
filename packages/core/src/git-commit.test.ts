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
  commitRepoChanges,
  buildControlCommitMessage,
  buildSkillsCommitMessage,
  ensureCleanOrBootstrap,
  inferScope,
  truncateList,
  withCliMutation,
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

describe('commit messages', () => {
  it('prefers the command path for the scope', () => {
    expect(inferScope('skill add', ['route.json'])).toBe('skill');
    expect(inferScope('package copy', ['skill.json'])).toBe('package');
    expect(inferScope('target remove', ['route.json'])).toBe('target');
    expect(inferScope('route add', ['route.json'])).toBe('route');
    expect(inferScope('gc', ['skill.json', 'skills/pdf/1.0.0/SKILL.md'])).toBe(
      'gc',
    );
  });

  it('derives a scope from changed files when the command is unknown', () => {
    expect(inferScope('', ['package.json'])).toBe('package');
    expect(inferScope('', ['skill.json'])).toBe('skill');
    expect(inferScope('', ['locales/zh-CN.json'])).toBe('locale');
    expect(inferScope('', ['skills/pdf/1.0.0/SKILL.md'])).toBe('skills');
    expect(inferScope('', ['route.json'])).toBe('route');
    expect(inferScope('', ['route.json', 'package.json'])).toBe('config');
    expect(inferScope('', [])).toBe('config');
  });

  it('builds a control commit message with command and changed files', () => {
    const message = buildControlCommitMessage({
      commandPath: 'skill add',
      argv: ['skill', 'add', 'C:/src/pdf', '--name', 'pdf'],
      action: 'add',
      summary: 'pdf@1.0.0',
      changedFiles: ['route.json', 'skill.json'],
    });

    expect(message.split('\n')[0]).toBe('skillink(skill): add pdf@1.0.0');
    expect(message).toContain(
      'Command: skillink skill add C:/src/pdf --name pdf',
    );
    expect(message).toContain('Changed:\n- route.json\n- skill.json');
  });

  it('forces the skills scope in the skills repository', () => {
    const message = buildSkillsCommitMessage({
      commandPath: 'skill add',
      argv: ['skill', 'add', 'pdf'],
      action: 'add',
      summary: 'pdf@1.0.0',
      changedFiles: ['pdf/1.0.0/SKILL.md'],
    });

    expect(message.split('\n')[0]).toBe('skillink(skills): add pdf@1.0.0');
    expect(message).toContain('Changed:\n- pdf/1.0.0/SKILL.md');
  });

  it('truncates long subjects and long file lists', () => {
    const message = buildControlCommitMessage({
      commandPath: 'package copy',
      argv: ['package', 'copy', 'a@1.0.0', 'b@1.0.0'],
      action: 'copy',
      summary: 'x'.repeat(200),
      changedFiles: Array.from({ length: 25 }, (_, index) => `file-${index}.json`),
    });
    const [subject] = message.split('\n');

    expect(subject!.length).toBeLessThanOrEqual(72);
    expect(subject!.endsWith('...')).toBe(true);
    expect(message).toContain('- file-19.json');
    expect(message).not.toContain('- file-20.json');
    expect(message).toContain('... and 5 more');
  });

  it('truncates file lists to twenty entries', () => {
    expect(truncateList(Array.from({ length: 3 }, (_, i) => `${i}`), 20)).toEqual(
      ['0', '1', '2'],
    );
  });
});

describe.skipIf(!gitReady)('repository commits', () => {
  it('commits a complete control plane when bootstrapping a fresh home', async () => {
    const paths = getSkillinkPaths(await tempHome());

    await ensureCleanOrBootstrap(paths, ['target', 'add', 'C:/target']);

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

    await ensureCleanOrBootstrap(paths, ['skill', 'tag']);

    expect(await gitStatus(paths, 'control')).toEqual([]);
    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(init): initialize control plane',
    );
  });

  it('ignores stray untracked files in the home', async () => {
    const paths = await seededHome();
    await writeFile(path.join(paths.home, 'notes.txt'), 'private', 'utf8');

    await expect(
      ensureCleanOrBootstrap(paths, ['skill', 'tag']),
    ).resolves.toBeUndefined();

    await writeFile(
      paths.routeFile,
      '{"schemaVersion":2,"targets":[1]}',
      'utf8',
    );
    await commitRepoChanges({
      paths,
      repo: 'control',
      commandPath: 'target add',
      argv: ['target', 'add'],
      action: 'add',
      summary: 'a',
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
      commandPath: 'target add',
      argv: ['target', 'add', 'C:/targets/a', '--id', 'a'],
      action: 'add',
      summary: 'a -> C:/targets/a',
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
        commandPath: 'target add',
        argv: ['target', 'add', 'C:/targets/a'],
      }),
    ).toBeUndefined();
    expect(await gitLog(paths, 'control')).toHaveLength(2);
  });

  it('rejects a dirty control repository before a mutation', async () => {
    const paths = await seededHome();
    await writeFile(paths.routeFile, '{"schemaVersion":2,"targets":[9]}', 'utf8');

    await expect(
      withCliMutation(
        {
          paths,
          commandPath: 'skill tag',
          argv: ['skill', 'tag', 'pdf@1.0.0', 'latest'],
          action: 'tag',
          summary: 'pdf@1.0.0 as latest',
        },
        async () => 'never',
      ),
    ).rejects.toMatchObject({
      code: 'GIT_DIRTY',
      message: expect.stringMatching(/route\.json[\s\S]*git -C/),
    });
  });

  it('commits skills before the control plane', async () => {
    const paths = await seededHome();

    await withCliMutation(
      {
        paths,
        commandPath: 'skill add',
        argv: ['skill', 'add', 'pdf'],
        action: 'add',
        summary: 'pdf@1.0.0',
        skills: true,
      },
      async () => {
        await mkdir(path.join(paths.libraryDir, 'pdf', '1.0.0'), {
          recursive: true,
        });
        await writeFile(
          path.join(paths.libraryDir, 'pdf', '1.0.0', 'SKILL.md'),
          '# pdf',
          'utf8',
        );
        await writeFile(
          paths.skillFile,
          JSON.stringify({ schemaVersion: 2, skills: { pdf: { versions: {} } } }),
          'utf8',
        );
      },
    );

    const skillsLog = await gitLog(paths, 'skills');
    const controlLog = await gitLog(paths, 'control');
    expect(skillsLog[0]?.reason).toBe('skillink(skills): add pdf@1.0.0');
    expect(controlLog[0]?.reason).toBe('skillink(skill): add pdf@1.0.0');
    expect(await gitStatus(paths, 'control')).toEqual([]);
    expect(await gitStatus(paths, 'skills')).toEqual([]);
  });

  it('skips commits for read-only mutations but still locks', async () => {
    const paths = await seededHome();

    await withCliMutation(
      {
        paths,
        commandPath: 'apply',
        argv: ['apply'],
        action: 'apply',
        summary: '',
        commit: false,
      },
      async () => {
        await writeFile(
          paths.routeFile,
          '{"schemaVersion":2,"targets":[7]}',
          'utf8',
        );
      },
    );

    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(init): initialize control plane',
    );
    expect(await gitStatus(paths, 'control')).not.toEqual([]);
  });

  it('does not commit when the mutation fails', async () => {
    const paths = await seededHome();
    const before = await gitHead(paths, 'control');

    await expect(
      withCliMutation(
        {
          paths,
          commandPath: 'skill add',
          argv: ['skill', 'add', 'pdf'],
          action: 'add',
          summary: 'pdf@1.0.0',
          skills: true,
        },
        async () => {
          await writeFile(
            paths.routeFile,
            '{"schemaVersion":2,"targets":[7]}',
            'utf8',
          );
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');

    expect(await gitHead(paths, 'control')).toBe(before);
  });
});
