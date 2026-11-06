import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ControlPlaneFileSchema,
  controlPlanePathKey,
  getControlPlaneRegistryPath,
  mergeControlPlanePaths,
  normalizeControlPlanePath,
} from './control-plane.js';
import { getSkillinkHomeOverride } from './paths.js';

describe('control plane registry primitives', () => {
  it('uses the Windows roaming app data directory', () => {
    expect(
      getControlPlaneRegistryPath({
        platform: 'win32',
        homedir: 'C:/Users/me',
        env: { APPDATA: 'C:/Users/me/AppData/Roaming' },
      }),
    ).toBe(path.join('C:/Users/me/AppData/Roaming', 'Skillink', 'control-planes.json'));
  });

  it('uses Application Support on macOS and XDG config on Linux', () => {
    expect(
      getControlPlaneRegistryPath({
        platform: 'darwin',
        homedir: '/Users/me',
        env: {},
      }),
    ).toBe(
      path.join('/Users/me', 'Library', 'Application Support', 'Skillink', 'control-planes.json'),
    );
    expect(
      getControlPlaneRegistryPath({
        platform: 'linux',
        homedir: '/home/me',
        env: { XDG_CONFIG_HOME: '/home/me/.config' },
      }),
    ).toBe(path.join('/home/me/.config', 'skillink', 'control-planes.json'));
  });

  it('normalizes paths and dedupes case-insensitively on Windows', () => {
    const env = { HOME: '/home/me' } as NodeJS.ProcessEnv;
    const first = normalizeControlPlanePath('~/planes/a', env);
    expect(first).toBe(path.resolve('/home/me/planes/a'));
    expect(mergeControlPlanePaths([first], [first.toUpperCase()], 'win32')).toEqual([first]);
    expect(mergeControlPlanePaths([], [first, first], 'linux')).toEqual([first]);
    expect(controlPlanePathKey('C:/A/B', 'win32')).toBe('c:/a/b');
  });

  it('accepts an empty registry and keeps a null active value', () => {
    expect(
      ControlPlaneFileSchema.parse({
        schemaVersion: 1,
        active: null,
        controlPlanes: [],
      }),
    ).toEqual({ schemaVersion: 1, active: null, controlPlanes: [] });
  });

  it('reads SKILLINK_HOME as an expanded override', () => {
    expect(getSkillinkHomeOverride({ SKILLINK_HOME: '~/planes' } as NodeJS.ProcessEnv)).toBe(
      path.resolve(path.join(os.homedir(), 'planes')),
    );
    expect(getSkillinkHomeOverride({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
