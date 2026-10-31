import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ApplyReport } from '@skillink/shared';
import { isGitAvailable } from '@skillink/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createCliAdapter,
  type CliRunner,
} from './cli-adapter.js';

const gitReady = await isGitAvailable();

function runnerReturning(output: {
  code: number;
  stdout?: string;
  stderr?: string;
}): { runner: CliRunner; seen: string[][] } {
  const seen: string[][] = [];
  const runner: CliRunner = async (argv, context) => {
    seen.push(argv);
    if (output.stdout) {
      for (const line of output.stdout.split('\n')) {
        context.stdout(line);
      }
    }
    if (output.stderr) {
      for (const line of output.stderr.split('\n')) {
        context.stderr(line);
      }
    }
    return output.code;
  };
  return { runner, seen };
}

describe('CLI adapter', () => {
  it('appends --json and parses stdout JSON', async () => {
    const { runner, seen } = runnerReturning({
      code: 0,
      stdout: '{"ok":true}',
    });
    const adapter = createCliAdapter(runner);

    await expect(adapter.invoke(['skill', 'list'])).resolves.toEqual({
      ok: true,
    });
    expect(seen).toEqual([['skill', 'list', '--json']]);
  });

  it('returns JSON data even when status exits 1', async () => {
    const { runner } = runnerReturning({
      code: 1,
      stdout: '{"healthy":false,"entries":[]}',
    });
    const adapter = createCliAdapter(runner);

    await expect(adapter.invoke(['status', '--json'])).resolves.toEqual({
      healthy: false,
      entries: [],
    });
  });

  it('returns apply conflict reports when the CLI exits 3', async () => {
    const { runner } = runnerReturning({
      code: 3,
      stdout:
        '{"dryRun":false,"ok":false,"operations":[],"conflicts":[{"name":"pdf"}]}',
    });
    const adapter = createCliAdapter(runner);

    await expect(adapter.invoke(['apply'])).resolves.toMatchObject({
      ok: false,
    });
  });

  it('throws a structured error when no JSON result exists', async () => {
    const { runner } = runnerReturning({
      code: 1,
      stderr:
        '{"ok":false,"error":{"code":"SKILL_MD_REQUIRED","message":"SKILL.md required"}}',
    });
    const adapter = createCliAdapter(runner);

    await expect(
      adapter.invoke(['skill', 'add', 'C:/bad']),
    ).rejects.toMatchObject({
      name: 'CliCommandError',
      code: 'SKILL_MD_REQUIRED',
      message: 'SKILL.md required',
      exitCode: 1,
    });
  });

  it('prefers a structured stderr error over stale success JSON', async () => {
    const { runner } = runnerReturning({
      code: 1,
      stdout: '{"ok":true,"name":"pdf","version":"1.0.0"}',
      stderr:
        '{"ok":false,"error":{"code":"GIT_COMMIT_FAILED","message":"commit failed"}}',
    });
    const adapter = createCliAdapter(runner);

    await expect(adapter.invoke(['skill', 'add', 'pdf'])).rejects.toMatchObject({
      code: 'GIT_COMMIT_FAILED',
      message: 'commit failed',
      exitCode: 1,
    });
  });

  it('serializes concurrent invocations', async () => {
    let releaseFirst: (() => void) | undefined;
    const started: string[] = [];
    const runner: CliRunner = async (argv, context) => {
      started.push(argv.join(' '));
      if (argv[0] === 'first') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      context.stdout('{}');
      return 0;
    };
    const adapter = createCliAdapter(runner);

    const first = adapter.invoke(['first']);
    const second = adapter.invoke(['second']);
    await Promise.resolve();
    expect(started).toEqual(['first --json']);

    releaseFirst?.();
    await expect(first).resolves.toEqual({});
    await expect(second).resolves.toEqual({});
    expect(started).toEqual(['first --json', 'second --json']);
  });

  it('continues after a rejected invocation', async () => {
    const calls: string[] = [];
    const runner: CliRunner = async (argv, context) => {
      calls.push(argv[0]!);
      if (argv[0] === 'first') {
        context.stderr(
          '{"ok":false,"error":{"code":"CLI_ERROR","message":"boom"}}',
        );
        return 1;
      }
      context.stdout('{"ok":true}');
      return 0;
    };
    const adapter = createCliAdapter(runner);

    await expect(adapter.invoke(['first'])).rejects.toMatchObject({
      code: 'CLI_ERROR',
      message: 'boom',
    });
    await expect(adapter.invoke(['second'])).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['first', 'second']);
  });

  it('reads runtime status through the env command', async () => {
    const { runner, seen } = runnerReturning({
      code: 0,
      stdout: '{"gitAvailable":false}',
    });
    const adapter = createCliAdapter(runner);

    await expect(adapter.runtimeStatus()).resolves.toEqual({
      gitAvailable: false,
    });
    expect(seen).toEqual([['env', '--json']]);
  });

  it('snapshots through the snapshot command', async () => {    const { runner, seen } = runnerReturning({
      code: 0,
      stdout: JSON.stringify({
        home: 'C:/home',
        skills: { schemaVersion: 2, skills: {} },
        packages: { schemaVersion: 2, packages: {} },
        route: { schemaVersion: 2, targets: [] },
        status: { healthy: true, entries: [] },
        doctor: { ok: true, issues: [] },
        targetSkills: [],
      }),
    });
    const adapter = createCliAdapter(runner);

    await expect(adapter.snapshot()).resolves.toMatchObject({
      home: 'C:/home',
    });
    expect(seen).toEqual([['snapshot', '--json']]);
  });

  it.skipIf(!gitReady)('runs end-to-end against the real CLI', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skillink-adapter-'));
    const home = path.join(root, 'home');
    const source = path.join(root, 'source');
    const targetPath = path.join(root, 'target');
    await mkdir(source, { recursive: true });
    await mkdir(targetPath, { recursive: true });
    await writeFile(path.join(source, 'SKILL.md'), '# pdf', 'utf8');
    await writeFile(path.join(source, 'file.txt'), 'hello', 'utf8');

    vi.stubEnv('SKILLINK_HOME', home);
    try {
      const adapter = createCliAdapter();

      for (const name of ['pdf', 'review']) {
        await adapter.invoke([
          'skill',
          'add',
          source,
          '--name',
          name,
          '--version',
          '1.0.0',
        ]);
      }
      await adapter.invoke([
        'package',
        'create',
        'demo@1.0.0',
        '--skill',
        'pdf@1.0.0',
        'review@1.0.0',
      ]);
      await adapter.invoke([
        'target',
        'add',
        targetPath,
        '--id',
        'project-a',
      ]);
      await adapter.invoke(['route', 'add', 'project-a', 'demo@1.0.0']);
      await adapter.invoke(['apply']);

      const snapshot = await adapter.snapshot();

      expect(snapshot.home).toBe(path.resolve(home));
      expect(snapshot.skills.skills.pdf).toBeDefined();
      expect(snapshot.targetSkills).toEqual([
        {
          targetId: 'project-a',
          skills: [
            { name: 'pdf', version: '1.0.0' },
            { name: 'review', version: '1.0.0' },
          ],
        },
      ]);
      expect(snapshot.status.healthy).toBe(true);
      expect(snapshot.doctor.ok).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!gitReady)('replaces a same-name real directory through the real CLI', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'skillink-adapter-'));
    const home = path.join(root, 'home');
    const source = path.join(root, 'source');
    const targetPath = path.join(root, 'target');
    await mkdir(source, { recursive: true });
    await mkdir(path.join(targetPath, 'pdf'), { recursive: true });
    await writeFile(path.join(source, 'SKILL.md'), '# pdf', 'utf8');
    await writeFile(
      path.join(targetPath, 'pdf', 'unmanaged.txt'),
      'keep',
      'utf8',
    );

    vi.stubEnv('SKILLINK_HOME', home);
    try {
      const adapter = createCliAdapter();

      await adapter.invoke([
        'skill',
        'add',
        source,
        '--name',
        'pdf',
        '--version',
        '1.0.0',
      ]);
      await adapter.invoke([
        'package',
        'create',
        'demo@1.0.0',
        '--skill',
        'pdf@1.0.0',
      ]);
      await adapter.invoke([
        'target',
        'add',
        targetPath,
        '--id',
        'project-a',
      ]);
      await adapter.invoke(['route', 'add', 'project-a', 'demo@1.0.0']);

      const report = await adapter.invoke<ApplyReport>(['apply']);

      expect(report.ok).toBe(true);
      expect(report.conflicts).toEqual([]);
      expect(
        (await lstat(path.join(targetPath, 'pdf'))).isSymbolicLink(),
      ).toBe(true);
      await expect(
        readFile(path.join(targetPath, 'pdf', 'unmanaged.txt'), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });
});
