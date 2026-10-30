import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli, type CliContext } from './index.js';

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function context(home: string): CliContext & { out: string[]; err: string[] } {
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('CLI', () => {
  it('prints help and exits zero', async () => {
    const ctx = context(await tempDir('skillink-cli-'));

    const code = await runCli(['--help'], ctx);

    expect(code).toBe(0);
    expect(ctx.out.join('\n')).toContain('Usage');
  });

  it('imports a folder, adds a target, routes a version, and applies it', async () => {
    const root = await tempDir('skillink-cli-');
    const home = path.join(root, 'home');
    const source = path.join(root, 'source');
    const targetPath = path.join(root, 'project', 'packages');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'file.txt'), 'hello', 'utf8');
    await mkdir(targetPath, { recursive: true });
    const ctx = context(home);

    expect(
      await runCli(
        ['add', source, '--name', 'demo', '--version', '1.0.0'],
        ctx,
      ),
    ).toBe(0);
    expect(
      await runCli(
        ['target', 'add', targetPath, '--id', 'project-a', '--label', 'Project A'],
        ctx,
      ),
    ).toBe(0);
    expect(await runCli(['route', 'add', 'project-a', 'demo@1.0.0'], ctx)).toBe(0);
    expect(await runCli(['apply'], ctx)).toBe(0);

    expect((await lstat(path.join(targetPath, 'demo'))).isSymbolicLink()).toBe(true);
    const library = JSON.parse(
      await readFile(path.join(home, 'skills.json'), 'utf8'),
    ) as { packages: { demo: { versions: Record<string, unknown> } } };
    expect(library.packages.demo.versions['1.0.0']).toBeDefined();
  });

  it('prints machine-readable status JSON', async () => {
    const root = await tempDir('skillink-cli-');
    const home = path.join(root, 'home');
    const source = path.join(root, 'source');
    const targetPath = path.join(root, 'project', 'packages');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'file.txt'), 'hello', 'utf8');
    await mkdir(targetPath, { recursive: true });
    const ctx = context(home);

    await runCli(['add', source, '--name', 'demo', '--version', '1.0.0'], ctx);
    await runCli(['target', 'add', targetPath, '--id', 'project-a'], ctx);
    await runCli(['route', 'add', 'project-a', 'demo@1.0.0'], ctx);
    await runCli(['apply'], ctx);
    ctx.out.length = 0;

    expect(await runCli(['status', '--json'], ctx)).toBe(0);
    const report = JSON.parse(ctx.out.join('\n')) as {
      healthy: boolean;
      entries: Array<{ name: string; state: string }>;
    };
    expect(report.healthy).toBe(true);
    expect(report.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'demo', state: 'ok' })]),
    );
  });

  it('returns a non-zero code for an invalid package spec', async () => {
    const ctx = context(await tempDir('skillink-cli-'));

    expect(await runCli(['route', 'add', 'missing', 'broken'], ctx)).toBe(1);
    expect(ctx.err.join('\n')).toMatch(/package@version|invalid/i);
  });
});
