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
import { afterEach, expect, it, vi } from 'vitest';
import { isGitAvailable } from '@skillink/core';
import { getControlPlaneRegistryPath, getSkillinkPaths } from '@skillink/shared';
import { runCli, type CliContext } from './run.js';

const roots: string[] = [];
const gitReady = await isGitAvailable();

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skillink-control-plane-'));
  roots.push(root);
  return root;
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

function registryEnv(root: string): void {
  if (process.platform === 'win32') {
    vi.stubEnv('APPDATA', path.join(root, 'appdata'));
  } else {
    vi.stubEnv('XDG_CONFIG_HOME', path.join(root, 'config'));
  }
  vi.stubEnv('SKILLINK_HOME', '');
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it('starts empty without a default control plane', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const ctx = context();
  expect(await runCli(['control-plane', 'list', '--json'], ctx)).toBe(0);
  expect(JSON.parse(ctx.out.join('\n'))).toEqual({
    active: null,
    activeSource: null,
    controlPlanes: [],
  });
});

it('adds, switches, and reloads the home used by snapshot', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const first = path.join(root, 'planes', 'a');
  const second = path.join(root, 'planes', 'b');

  expect(await runCli(['control-plane', 'add', first, '--json'], context())).toBe(0);
  expect(await runCli(['control-plane', 'add', second, '--json'], context())).toBe(0);

  const useCtx = context();
  expect(await runCli(['control-plane', 'use', second, '--json'], useCtx)).toBe(0);
  expect(JSON.parse(useCtx.out.join('\n'))).toMatchObject({
    active: path.resolve(second),
    activeSource: 'registry',
  });

  const snapshotCtx = context();
  expect(await runCli(['snapshot', '--json'], snapshotCtx)).toBe(0);
  expect(JSON.parse(snapshotCtx.out.join('\n'))).toMatchObject({
    home: path.resolve(second),
  });
  await stat(second);
});

it('switches to a deleted path and reports it in snapshot', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const home = path.join(root, 'planes', 'deleted');
  await runCli(['control-plane', 'add', home, '--json'], context());
  await rm(home, { recursive: true, force: true });

  expect(await runCli(['control-plane', 'use', home, '--json'], context())).toBe(0);
  const snapshotCtx = context();
  expect(await runCli(['snapshot', '--json'], snapshotCtx)).toBe(0);
  expect(JSON.parse(snapshotCtx.out.join('\n'))).toMatchObject({
    home: path.resolve(home),
  });
});

it('requires a control plane for commands that need one', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const ctx = context();
  expect(await runCli(['snapshot', '--json'], ctx)).toBe(1);
  expect(ctx.err.join('\n')).toContain('CONTROL_PLANE_REQUIRED');
});

it('lets SKILLINK_HOME override the registry', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const registered = path.join(root, 'planes', 'registered');
  const override = path.join(root, 'planes', 'override');
  await runCli(['control-plane', 'add', registered, '--json'], context());
  vi.stubEnv('SKILLINK_HOME', override);

  const ctx = context();
  expect(await runCli(['control-plane', 'list', '--json'], ctx)).toBe(0);
  expect(JSON.parse(ctx.out.join('\n'))).toMatchObject({
    active: path.resolve(override),
    activeSource: 'env',
  });
});

it('keeps help and env working when the registry is corrupt', async () => {
  const root = await tempRoot();
  registryEnv(root);
  const registryFile = getControlPlaneRegistryPath();
  await mkdir(path.dirname(registryFile), { recursive: true });
  await writeFile(registryFile, '{ broken', 'utf8');

  expect(await runCli(['--help'], context())).toBe(0);
  expect(await runCli(['env', '--json'], context())).toBe(0);

  const listCtx = context();
  expect(await runCli(['control-plane', 'list', '--json'], listCtx)).toBe(1);
  expect(listCtx.err.join('\n')).toContain('IO_ERROR');
});

it.skipIf(!gitReady)(
  'imports into the active registry home, not the omitted context home',
  async () => {
    const root = await tempRoot();
    registryEnv(root);
    const home = path.join(root, 'planes', 'active');
    await runCli(['control-plane', 'add', home], context());

    const source = path.join(root, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'SKILL.md'), '# demo', 'utf8');

    const ctx = context();
    expect(
      await runCli(
        ['skill', 'add', source, '--name', 'demo', '--version', '1.0.0', '--json'],
        ctx,
      ),
    ).toBe(0);

    const skillFile = getSkillinkPaths(home).skillFile;
    const skill = JSON.parse(await readFile(skillFile, 'utf8'));
    expect(skill.skills.demo.versions['1.0.0']).toBeDefined();
  },
);
