import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
