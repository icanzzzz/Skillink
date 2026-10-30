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

  it('lists history and rolls back the route', async () => {
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
    ctx.out.length = 0;

    expect(await runCli(['history', '--json'], ctx)).toBe(0);
    const entries = JSON.parse(ctx.out.join('\n')) as Array<{
      id: string;
      createdAt: string;
      reason: string;
    }>;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toMatchObject({
      id: expect.any(String),
      createdAt: expect.any(String),
      reason: expect.any(String),
    });
    expect(entries[0]!.id).not.toContain(':');

    const snapshotId = entries[0]!.id;
    await runCli(['route', 'add', 'project-a', 'demo@1.0.0'], ctx);
    const routed = JSON.parse(
      await readFile(path.join(home, 'route.json'), 'utf8'),
    ) as { targets: Array<{ skills: Record<string, unknown> }> };
    expect(routed.targets[0]?.skills.demo).toBeDefined();

    ctx.out.length = 0;
    expect(await runCli(['rollback', snapshotId, '--json'], ctx)).toBe(0);
    const restored = JSON.parse(
      await readFile(path.join(home, 'route.json'), 'utf8'),
    ) as { targets: Array<{ skills: Record<string, unknown> }> };
    expect(restored.targets[0]?.skills.demo).toBeUndefined();
  });

  it('rolls back and applies in one command', async () => {
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
    await runCli(['target', 'add', path.join(root, 'other'), '--id', 'project-b'], ctx);

    ctx.out.length = 0;
    await runCli(['history', '--json'], ctx);
    const entries = JSON.parse(ctx.out.join('\n')) as Array<{ id: string }>;
    const routedSnapshot = entries[0]!.id;

    await runCli(['route', 'remove', 'project-a', 'demo'], ctx);
    ctx.out.length = 0;
    expect(await runCli(['rollback', routedSnapshot, '--apply'], ctx)).toBe(0);
    expect((await lstat(path.join(targetPath, 'demo'))).isSymbolicLink()).toBe(true);
  });

  it('returns a non-zero code when rolling back a missing snapshot', async () => {
    const ctx = context(await tempDir('skillink-cli-'));

    expect(await runCli(['rollback', 'missing-snapshot'], ctx)).toBe(1);
    expect(ctx.err.join('\n')).toMatch(/history|snapshot|not found/i);
  });

  it('tags and removes unreferenced library versions', async () => {
    const root = await tempDir('skillink-cli-');
    const home = path.join(root, 'home');
    const source = path.join(root, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'file.txt'), 'hello', 'utf8');
    const ctx = context(home);

    await runCli(['add', source, '--name', 'demo', '--version', '1.0.0'], ctx);
    await runCli(['add', source, '--name', 'demo', '--version', '1.1.0'], ctx);

    expect(await runCli(['library', 'tag', 'demo@1.0.0', 'stable'], ctx)).toBe(0);
    const tagged = JSON.parse(
      await readFile(path.join(home, 'skills.json'), 'utf8'),
    ) as { packages: { demo: { tags: Record<string, string> } } };
    expect(tagged.packages.demo.tags.stable).toBe('1.0.0');

    expect(await runCli(['library', 'remove', 'demo@1.0.0'], ctx)).toBe(0);
    const remaining = JSON.parse(
      await readFile(path.join(home, 'skills.json'), 'utf8'),
    ) as { packages: { demo: { versions: Record<string, unknown>; tags?: Record<string, string> } } };
    expect(remaining.packages.demo.versions['1.0.0']).toBeUndefined();
    expect(remaining.packages.demo.tags?.stable).toBeUndefined();
    await expect(lstat(path.join(home, 'skills', 'demo', '1.0.0'))).rejects.toThrow();
  });

  it('refuses to remove a library version referenced by a route', async () => {
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

    expect(await runCli(['library', 'remove', 'demo@1.0.0'], ctx)).toBe(1);
    expect(ctx.err.join('\n')).toMatch(/VERSION_IN_USE|still used/i);
  });

  it('runs gc as a dry run by default and applies with --apply', async () => {
    const root = await tempDir('skillink-cli-');
    const home = path.join(root, 'home');
    const source = path.join(root, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'file.txt'), 'hello', 'utf8');
    const ctx = context(home);

    await runCli(['add', source, '--name', 'demo', '--version', '1.0.0'], ctx);

    ctx.out.length = 0;
    expect(await runCli(['gc', '--max-age-days', '0', '--json'], ctx)).toBe(0);
    const dryRun = JSON.parse(ctx.out.join('\n')) as {
      dryRun: boolean;
      candidates: Array<{ name: string; version: string }>;
      removed: unknown[];
    };
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.candidates).toEqual([
      expect.objectContaining({ name: 'demo', version: '1.0.0' }),
    ]);
    expect(dryRun.removed).toEqual([]);
    await expect(lstat(path.join(home, 'skills', 'demo', '1.0.0'))).resolves.toBeDefined();

    ctx.out.length = 0;
    expect(
      await runCli(['gc', '--apply', '--max-age-days', '0', '--json'], ctx),
    ).toBe(0);
    const applied = JSON.parse(ctx.out.join('\n')) as {
      dryRun: boolean;
      removed: Array<{ name: string; version: string }>;
    };
    expect(applied.dryRun).toBe(false);
    expect(applied.removed).toEqual([
      expect.objectContaining({ name: 'demo', version: '1.0.0' }),
    ]);
    await expect(lstat(path.join(home, 'skills', 'demo', '1.0.0'))).rejects.toThrow();
  });
});
