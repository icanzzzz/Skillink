import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ControlPlanePathOptions } from '@skillink/shared';
import {
  addControlPlane,
  listControlPlanes,
  resolveControlPlaneHome,
  useControlPlane,
} from './control-plane-store.js';

const tempDirs: string[] = [];

function registryOptions(root: string): ControlPlanePathOptions {
  return process.platform === 'win32'
    ? { env: { ...process.env, APPDATA: path.join(root, 'appdata') } }
    : { env: { ...process.env, XDG_CONFIG_HOME: path.join(root, 'config') } };
}

async function setup(): Promise<{
  root: string;
  options: ControlPlanePathOptions;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skillink-control-plane-'));
  tempDirs.push(root);
  return { root, options: registryOptions(root) };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('control plane store', () => {
  it('returns an empty registry when the file is missing', async () => {
    const { options } = await setup();
    await expect(listControlPlanes(options)).resolves.toEqual({
      active: null,
      activeSource: null,
      controlPlanes: [],
    });
  });

  it('creates the first added directory and activates it', async () => {
    const { root, options } = await setup();
    const home = path.join(root, 'planes with space', 'a');
    const state = await addControlPlane(home, options);
    expect(state.active).toBe(path.resolve(home));
    expect(state.controlPlanes).toEqual([path.resolve(home)]);
    await expect(stat(home)).resolves.toMatchObject({});
  });

  it('adds later control planes without changing the active one', async () => {
    const { root, options } = await setup();
    const first = path.join(root, 'planes', 'a');
    const second = path.join(root, 'planes', 'b');
    await addControlPlane(first, options);
    const state = await addControlPlane(second, options);
    expect(state.active).toBe(path.resolve(first));
    expect(state.controlPlanes).toEqual([
      path.resolve(first),
      path.resolve(second),
    ]);
  });

  it('switches only to a registered control plane', async () => {
    const { root, options } = await setup();
    const first = path.join(root, 'planes', 'a');
    const second = path.join(root, 'planes', 'b');
    await addControlPlane(first, options);
    await addControlPlane(second, options);
    await expect(useControlPlane(second, options)).resolves.toMatchObject({
      active: path.resolve(second),
    });
    await expect(
      useControlPlane(path.join(root, 'planes', 'missing'), options),
    ).rejects.toMatchObject({
      code: 'CONTROL_PLANE_NOT_FOUND',
    });
  });

  it('rejects a file at the control plane path', async () => {
    const { root, options } = await setup();
    const file = path.join(root, 'planes', 'file');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'x', 'utf8');
    await expect(addControlPlane(file, options)).rejects.toMatchObject({
      code: 'CONTROL_PLANE_NOT_FOUND',
    });
  });

  it('lets SKILLINK_HOME override the registry active path', async () => {
    const { root, options } = await setup();
    const first = path.join(root, 'planes', 'a');
    await addControlPlane(first, options);
    const env = { ...options.env, SKILLINK_HOME: path.join(root, 'env-home') };
    await expect(listControlPlanes({ ...options, env })).resolves.toMatchObject(
      {
        active: path.resolve(path.join(root, 'env-home')),
        activeSource: 'env',
      },
    );
    await expect(
      resolveControlPlaneHome({ ...options, env }),
    ).resolves.toMatchObject({
      home: path.resolve(path.join(root, 'env-home')),
      source: 'env',
    });
  });

  it('returns null when there is no env override and no active path', async () => {
    const { options } = await setup();
    await expect(resolveControlPlaneHome(options)).resolves.toEqual({
      home: null,
      source: null,
    });
  });
});
