import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCommandRuntime } from './command-runtime.js';
import { runCli } from './run.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('CLI command layer', () => {
  it('runs commands without the executable entry guard', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillink-run-'));
    dirs.push(home);
    const out: string[] = [];

    expect(
      await runCli(['init'], {
        home,
        stdout: (line) => out.push(line),
        stderr: () => undefined,
      }),
    ).toBe(0);
    expect(out.join('\n')).toContain('Initialized');
  });

  it('exposes paths and home initialization through the command runtime', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'skillink-runtime-'));
    dirs.push(home);
    const context = {
      home,
      stdout: () => undefined,
      stderr: () => undefined,
    };
    const runtime = createCommandRuntime(context, ['env'], () => undefined);

    expect(runtime.paths().home).toBe(path.resolve(home));
    await runtime.ensureHome();
    await expect(stat(runtime.paths().routeFile)).resolves.toBeDefined();
  });
});
