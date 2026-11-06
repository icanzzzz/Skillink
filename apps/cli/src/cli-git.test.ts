import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitHead, gitLog, gitShowFile, gitStatus, isGitAvailable } from '@skillink/core';
import { getSkillinkPaths } from '@skillink/shared';
import { runCli, type CliContext } from './run.js';

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function context(home?: string): CliContext & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    home,
    out,
    err,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  };
}

async function makeSkillSource(
  name = 'demo',
  version = '1.0.0',
): Promise<string> {
  const root = await tempDir('skillink-cli-skill-');
  const source = path.join(root, `${name}@${version}`);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'SKILL.md'), `# ${name}`, 'utf8');
  return source;
}

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch(() => false);
}

async function seedSkill(home: string, ctx: CliContext): Promise<void> {
  const source = await makeSkillSource();
  expect(
    await runCli(['skill', 'add', source, '--name', 'demo', '--version', '1.0.0'], ctx),
  ).toBe(0);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(!(await isGitAvailable()))('CLI git integration', () => {
  it('initializes both repositories with baseline commits', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const paths = getSkillinkPaths(home);

    expect(await runCli(['init'], ctx)).toBe(0);

    expect(await pathExists(path.join(home, '.git'))).toBe(true);
    expect(await pathExists(path.join(home, 'skills', '.git'))).toBe(true);

    const gitignore = await readFile(path.join(home, '.gitignore'), 'utf8');
    expect(gitignore.split(/\r?\n/)).toEqual(
      expect.arrayContaining([
        '/skills/',
        '/trash/',
        '/history/',
        '/settings.json',
        '.skillink.lock',
      ]),
    );
    expect(
      await readFile(path.join(home, '.gitattributes'), 'utf8'),
    ).toContain('* -text');

    expect(await gitLog(paths, 'control')).toEqual([
      expect.objectContaining({ reason: 'skillink(init): initialize control plane' }),
    ]);
    expect(await gitLog(paths, 'skills')).toEqual([
      expect.objectContaining({ reason: 'skillink(skills): initialize skills' }),
    ]);
  });

  it('baselines an existing home that has no git repository', async () => {
    const home = await tempDir('skillink-cli-');
    await writeFile(
      path.join(home, 'route.json'),
      JSON.stringify({ schemaVersion: 2, targets: [] }),
      'utf8',
    );
    const ctx = context(home);

    expect(await runCli(['init'], ctx)).toBe(0);

    const paths = getSkillinkPaths(home);
    const log = await gitLog(paths, 'control');
    expect(log).toHaveLength(1);
    expect(log[0]?.reason).toBe('skillink(init): initialize control plane');
  });

  it('commits skill add to both repositories', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const paths = getSkillinkPaths(home);
    await runCli(['init'], ctx);

    await seedSkill(home, ctx);

    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(skill): add demo@1.0.0',
    );
    expect((await gitLog(paths, 'skills'))[0]?.reason).toBe(
      'skillink(skills): add demo@1.0.0',
    );
  });

  it('commits skill tag only to the control plane', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const paths = getSkillinkPaths(home);
    await runCli(['init'], ctx);
    await seedSkill(home, ctx);
    const skillsBefore = await gitLog(paths, 'skills');

    expect(await runCli(['skill', 'tag', 'demo@1.0.0', 'stable'], ctx)).toBe(0);

    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(skill): tag demo@1.0.0 as stable',
    );
    expect(await gitLog(paths, 'skills')).toHaveLength(skillsBefore.length);
  });

  it('commits package, target, and route mutations', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const paths = getSkillinkPaths(home);
    await runCli(['init'], ctx);
    await seedSkill(home, ctx);

    expect(
      await runCli(
        ['package', 'create', 'bundle@1.0.0', '--skill', 'demo@1.0.0'],
        ctx,
      ),
    ).toBe(0);
    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(package): create bundle@1.0.0',
    );

    const targetDir = await tempDir('skillink-target-');
    expect(
      await runCli(['target', 'add', targetDir, '--id', 'project-a'], ctx),
    ).toBe(0);
    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(target): add project-a',
    );

    expect(
      await runCli(['route', 'add', 'project-a', 'bundle@1.0.0'], ctx),
    ).toBe(0);
    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(route): add project-a bundle@1.0.0',
    );
  });

  it('does not commit read-only, apply, package check, or dry-run commands', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const paths = getSkillinkPaths(home);
    await runCli(['init'], ctx);
    await seedSkill(home, ctx);
    const before = await gitLog(paths, 'control');

    expect(await runCli(['skill', 'list'], ctx)).toBe(0);
    expect(await runCli(['apply'], ctx)).toBe(0);
    expect(await runCli(['package', 'check'], ctx)).toBe(0);
    expect(await runCli(['gc'], ctx)).toBe(0);

    expect(await gitLog(paths, 'control')).toHaveLength(before.length);
  });

  it('does not create an empty commit when nothing changes', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const paths = getSkillinkPaths(home);
    await runCli(['init'], ctx);
    await seedSkill(home, ctx);
    await runCli(['skill', 'tag', 'demo@1.0.0', 'stable'], ctx);
    const before = await gitLog(paths, 'control');

    expect(await runCli(['skill', 'tag', 'demo@1.0.0', 'stable'], ctx)).toBe(0);

    expect(await gitLog(paths, 'control')).toHaveLength(before.length);
  });

  it('commits gc apply to both repositories', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const paths = getSkillinkPaths(home);
    await runCli(['init'], ctx);
    await seedSkill(home, ctx);
    const skillDir = path.join(home, 'skills', 'demo', '1.0.0');
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await utimes(skillDir, old, old);
    const skillsBefore = await gitLog(paths, 'skills');

    expect(await runCli(['gc', '--apply'], ctx)).toBe(0);

    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(gc): remove 1 unreferenced skill version',
    );
    expect((await gitLog(paths, 'skills'))[0]?.reason).toBe(
      'skillink(skills): remove 1 unreferenced skill version',
    );
    expect(await gitLog(paths, 'skills')).toHaveLength(skillsBefore.length + 1);
  });

  it('rejects writes when the control plane is dirty', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    await runCli(['init'], ctx);
    await writeFile(
      path.join(home, 'route.json'),
      JSON.stringify({
        schemaVersion: 2,
        targets: [
          {
            id: 'dirty',
            path: path.join(home, 'dirty-target'),
            mode: 'link',
            enabled: true,
            packages: {},
          },
        ],
      }),
      'utf8',
    );

    expect(await runCli(['skill', 'tag', 'demo@1.0.0', 'stable'], ctx)).toBe(1);
    expect(ctx.err.join('\n')).toContain('GIT_DIRTY');
  });

  it('ignores stray untracked files in the home', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const paths = getSkillinkPaths(home);
    await runCli(['init'], ctx);
    await writeFile(path.join(home, 'notes.txt'), 'private', 'utf8');

    await seedSkill(home, ctx);

    const head = await gitHead(paths, 'control');
    await expect(
      gitShowFile(paths, 'control', head!, 'notes.txt'),
    ).rejects.toBeInstanceOf(Error);
    expect(
      (await gitStatus(paths, 'control')).some((line) =>
        line.includes('notes.txt'),
      ),
    ).toBe(true);
  });

  it('does not mutate a dirty control plane when init is rejected', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    await runCli(['init'], ctx);
    const routePath = path.join(home, 'route.json');
    const dirtyRoute = JSON.stringify({
      schemaVersion: 2,
      targets: [
        {
          id: 'dirty',
          path: path.join(home, 'dirty-target'),
          mode: 'link',
          enabled: true,
          packages: {},
        },
      ],
    });
    await writeFile(routePath, dirtyRoute, 'utf8');

    expect(await runCli(['init'], ctx)).toBe(1);
    expect(ctx.err.join('\n')).toContain('GIT_DIRTY');
    expect(await readFile(routePath, 'utf8')).toBe(dirtyRoute);
  });

  it('reuses a clean hand-initialized control repository', async () => {
    const home = await tempDir('skillink-cli-');
    const paths = getSkillinkPaths(home);
    await mkdir(home, { recursive: true });
    await execFileAsync('git', ['init'], { cwd: home });
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
    await execFileAsync('git', ['add', '-A'], { cwd: home });
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
      { cwd: home },
    );

    const ctx = context(home);
    expect(await runCli(['init'], ctx)).toBe(0);
    expect(await gitStatus(paths, 'control')).toEqual([]);
    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      'skillink(init): initialize control plane',
    );
  });

  it('does not print a success result when auto-commit fails', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const source = await makeSkillSource('demo', '1.0.0');
    await runCli(['init'], ctx);
    await writeFile(path.join(home, '.git', 'index.lock'), '', 'utf8');
    ctx.out.length = 0;
    ctx.err.length = 0;

    const code = await runCli(
      ['skill', 'add', source, '--name', 'demo', '--version', '1.0.0', '--json'],
      ctx,
    );

    expect(code).toBe(1);
    expect(ctx.out.join('\n')).toBe('');
    expect(ctx.err.join('\n')).toMatch(/GIT_COMMAND_FAILED|GIT_COMMIT_FAILED/);
  });

  it('commits the remaining target, route, and package lifecycle', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const paths = getSkillinkPaths(home);
    await runCli(['init'], ctx);
    await seedSkill(home, ctx);
    await runCli(['package', 'create', 'bundle@1.0.0', '--skill', 'demo@1.0.0'], ctx);
    const targetDir = await tempDir('skillink-target-');
    await runCli(['target', 'add', targetDir, '--id', 'project-a'], ctx);
    await runCli(['route', 'add', 'project-a', 'bundle@1.0.0'], ctx);

    const steps: Array<{ args: string[]; subject: string }> = [
      {
        args: ['target', 'disable', 'project-a'],
        subject: 'skillink(target): disable project-a',
      },
      {
        args: ['target', 'enable', 'project-a'],
        subject: 'skillink(target): enable project-a',
      },
      {
        args: ['route', 'disable', 'project-a', 'bundle'],
        subject: 'skillink(route): disable project-a/bundle',
      },
      {
        args: ['route', 'enable', 'project-a', 'bundle'],
        subject: 'skillink(route): enable project-a/bundle',
      },
      {
        args: [
          'package',
          'create',
          'bundle@1.1.0',
          '--skill',
          'demo@1.0.0',
        ],
        subject: 'skillink(package): create bundle@1.1.0',
      },
      {
        args: ['package', 'tag', 'bundle@1.1.0', 'stable'],
        subject: 'skillink(package): tag bundle@1.1.0 as stable',
      },
      {
        args: ['package', 'remove', 'bundle@1.1.0'],
        subject: 'skillink(package): remove bundle@1.1.0',
      },
      {
        args: ['route', 'remove', 'project-a', 'bundle'],
        subject: 'skillink(route): remove project-a/bundle',
      },
      {
        args: ['target', 'remove', 'project-a'],
        subject: 'skillink(target): remove project-a',
      },
    ];

    for (const step of steps) {
      expect(await runCli(step.args, ctx)).toBe(0);
      expect((await gitLog(paths, 'control'))[0]?.reason).toBe(step.subject);
    }
  });

  it('migrates a v1 home without git in one commit', async () => {
    const home = await tempDir('skillink-cli-');
    const paths = getSkillinkPaths(home);
    await mkdir(path.join(home, 'skills', 'demo', '1.0.0'), {
      recursive: true,
    });
    await writeFile(
      path.join(home, 'skills', 'demo', '1.0.0', 'SKILL.md'),
      '# demo',
      'utf8',
    );
    await writeFile(
      path.join(home, 'skills.json'),
      JSON.stringify({
        schemaVersion: 1,
        packages: {
          demo: {
            versions: {
              '1.0.0': {
                integrity: 'sha512-demo',
                source: 'skills/demo/1.0.0',
                fileCount: 1,
                size: 5,
              },
            },
          },
        },
      }),
      'utf8',
    );
    const ctx = context(home);

    expect(await runCli(['migrate'], ctx)).toBe(0);

    expect(await pathExists(path.join(home, 'skill.json'))).toBe(true);
    expect(await pathExists(path.join(home, 'package.json'))).toBe(true);
    expect(await pathExists(path.join(home, 'skills.json'))).toBe(false);
    const log = await gitLog(paths, 'control');
    expect(log).toHaveLength(1);
    expect(log[0]?.reason).toBe(
      'skillink(migrate): migrate 1 skills, 1 packages, 0 targets',
    );
    expect(await gitStatus(paths, 'control')).toEqual([]);
  });

  it('reports runtime capabilities', async () => {
    const ctx = context(await tempDir('skillink-cli-'));

    expect(await runCli(['env', '--json'], ctx)).toBe(0);
    expect(JSON.parse(ctx.out.join('\n'))).toEqual({ gitAvailable: true });
  });

  it('lists git history as text and JSON', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    await runCli(['init'], ctx);
    await seedSkill(home, ctx);

    expect(await runCli(['history'], ctx)).toBe(0);
    expect(ctx.out.join('\n')).toContain('skillink(skill): add demo@1.0.0');

    ctx.out.length = 0;
    expect(await runCli(['history', '--json'], ctx)).toBe(0);
    const entries = JSON.parse(ctx.out.join('\n')) as Array<{
      id: string;
      createdAt: string;
      reason: string;
    }>;
    expect(entries[0]).toEqual(
      expect.objectContaining({ reason: 'skillink(skill): add demo@1.0.0' }),
    );
    expect(entries[0]!.id).toMatch(/^[0-9a-f]{40}$/);
  });

  it('rolls back to an earlier commit and cleans current targets', async () => {
    const home = await tempDir('skillink-cli-');
    const ctx = context(home);
    const paths = getSkillinkPaths(home);
    await runCli(['init'], ctx);
    await seedSkill(home, ctx);
    const revision = await gitHead(paths, 'control');
    const targetDir = await tempDir('skillink-target-');

    expect(
      await runCli(
        ['package', 'create', 'bundle@1.0.0', '--skill', 'demo@1.0.0'],
        ctx,
      ),
    ).toBe(0);
    expect(
      await runCli(['target', 'add', targetDir, '--id', 'project-a'], ctx),
    ).toBe(0);
    expect(
      await runCli(['route', 'add', 'project-a', 'bundle@1.0.0'], ctx),
    ).toBe(0);
    expect(await runCli(['apply'], ctx)).toBe(0);
    expect(await pathExists(path.join(targetDir, 'demo'))).toBe(true);

    expect(await runCli(['rollback', revision!], ctx)).toBe(0);

    expect(ctx.out.join('\n')).toContain(`Restored ${revision!.slice(0, 7)}`);
    expect(await pathExists(path.join(targetDir, 'demo'))).toBe(false);
    const route = JSON.parse(
      await readFile(path.join(home, 'route.json'), 'utf8'),
    ) as { targets: unknown[] };
    expect(route.targets).toEqual([]);
    expect((await gitLog(paths, 'control'))[0]?.reason).toBe(
      `skillink(rollback): restore ${revision!.slice(0, 7)}`,
    );
  });

  it('registers a successfully initialized control plane', async () => {
    const root = await tempDir('skillink-cli-init-register-');
    const home = path.join(root, 'planes', 'init');
    if (process.platform === 'win32') {
      vi.stubEnv('APPDATA', path.join(root, 'appdata'));
    } else {
      vi.stubEnv('XDG_CONFIG_HOME', path.join(root, 'config'));
    }
    vi.stubEnv('SKILLINK_HOME', home);

    const initCtx = context();
    expect(await runCli(['init'], initCtx)).toBe(0);

    vi.stubEnv('SKILLINK_HOME', '');
    const listCtx = context();
    expect(await runCli(['control-plane', 'list', '--json'], listCtx)).toBe(0);
    expect(JSON.parse(listCtx.out.join('\n'))).toMatchObject({
      active: path.resolve(home),
      controlPlanes: [path.resolve(home)],
    });
  });
});
