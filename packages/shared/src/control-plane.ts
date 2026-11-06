import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { SkillinkError } from './errors.js';
import { expandPath } from './path-expand.js';

export const ControlPlaneFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    active: z.string().min(1).nullable().default(null),
    controlPlanes: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type ControlPlaneFile = z.infer<typeof ControlPlaneFileSchema>;

export interface ControlPlaneState {
  active: string | null;
  activeSource: 'env' | 'registry' | null;
  controlPlanes: string[];
}

export interface ControlPlanePathOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
}

export function createEmptyControlPlaneFile(): ControlPlaneFile {
  return { schemaVersion: 1, active: null, controlPlanes: [] };
}

function envPath(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function getControlPlaneRegistryPath(
  options: ControlPlanePathOptions = {},
): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homedir = options.homedir ?? os.homedir();

  if (platform === 'win32') {
    const appData =
      envPath(env, 'APPDATA') ??
      path.join(homedir, 'AppData', 'Roaming');
    return path.join(appData, 'Skillink', 'control-planes.json');
  }

  if (platform === 'darwin') {
    return path.join(
      homedir,
      'Library',
      'Application Support',
      'Skillink',
      'control-planes.json',
    );
  }

  const configHome =
    envPath(env, 'XDG_CONFIG_HOME') ?? path.join(homedir, '.config');
  return path.join(configHome, 'skillink', 'control-planes.json');
}

export function normalizeControlPlanePath(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new SkillinkError('INVALID_PATH', 'A control plane path is required.');
  }

  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  return path.resolve(expandPath(trimmed, { env, home }));
}

function isRoot(value: string): boolean {
  return value === '/' || /^[A-Za-z]:\/$/.test(value);
}

export function controlPlanePathKey(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized =
    platform === 'win32'
      ? path.win32.normalize(value).replaceAll('\\', '/')
      : path.posix.normalize(value);
  const withoutTrailingSeparator = isRoot(normalized)
    ? normalized
    : normalized.replace(/\/+$/, '');

  return platform === 'win32'
    ? withoutTrailingSeparator.toLowerCase()
    : withoutTrailingSeparator;
}

export function mergeControlPlanePaths(
  existing: readonly string[],
  additions: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...existing, ...additions]) {
    const key = controlPlanePathKey(value, platform);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(value);
  }

  return merged;
}
