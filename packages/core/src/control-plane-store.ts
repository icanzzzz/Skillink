import { mkdir, stat } from 'node:fs/promises';
import {
  ControlPlaneFileSchema,
  SkillinkError,
  controlPlanePathKey,
  createEmptyControlPlaneFile,
  getControlPlaneRegistryPath,
  getSkillinkHomeOverride,
  mergeControlPlanePaths,
  normalizeControlPlanePath,
  type ControlPlaneFile,
  type ControlPlanePathOptions,
  type ControlPlaneState,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';
import { isNodeError } from './node-error.js';

function notADirectory(home: string): SkillinkError {
  return new SkillinkError(
    'CONTROL_PLANE_NOT_FOUND',
    'The control plane path is not a directory.',
    { path: home },
  );
}

function ioError(home: string, error: unknown): SkillinkError {
  return new SkillinkError(
    'IO_ERROR',
    `Failed to access control plane ${home}: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { path: home },
    { cause: error },
  );
}

function toControlPlaneState(
  file: ControlPlaneFile,
  options: ControlPlanePathOptions,
): ControlPlaneState {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const override = getSkillinkHomeOverride(env);
  const controlPlanes = file.active
    ? mergeControlPlanePaths(file.controlPlanes, [file.active], platform)
    : [...file.controlPlanes];

  return {
    active: override ?? file.active,
    activeSource: override ? 'env' : file.active ? 'registry' : null,
    controlPlanes,
  };
}

async function writeControlPlaneFile(
  file: ControlPlaneFile,
  options: ControlPlanePathOptions,
): Promise<void> {
  await writeJsonAtomic(
    getControlPlaneRegistryPath(options),
    file,
    ControlPlaneFileSchema,
  );
}

async function ensureControlPlaneDirectory(home: string): Promise<void> {
  try {
    const info = await stat(home);
    if (!info.isDirectory()) {
      throw notADirectory(home);
    }
    return;
  } catch (error) {
    if (error instanceof SkillinkError) {
      throw error;
    }
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw ioError(home, error);
    }
  }

  try {
    await mkdir(home, { recursive: true });
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === 'EEXIST' || error.code === 'ENOTDIR')
    ) {
      throw notADirectory(home);
    }
    throw ioError(home, error);
  }
}

export async function readControlPlaneFile(
  options: ControlPlanePathOptions = {},
): Promise<ControlPlaneFile> {
  return readJsonFile(
    getControlPlaneRegistryPath(options),
    ControlPlaneFileSchema,
    createEmptyControlPlaneFile(),
  );
}

export async function listControlPlanes(
  options: ControlPlanePathOptions = {},
): Promise<ControlPlaneState> {
  return toControlPlaneState(await readControlPlaneFile(options), options);
}

export async function addControlPlane(
  input: string,
  options: ControlPlanePathOptions = {},
): Promise<ControlPlaneState> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = normalizeControlPlanePath(input, env);

  await ensureControlPlaneDirectory(home);

  const file = await readControlPlaneFile(options);
  const next: ControlPlaneFile = {
    schemaVersion: 1,
    active: file.active ?? home,
    controlPlanes: mergeControlPlanePaths(file.controlPlanes, [home], platform),
  };

  await writeControlPlaneFile(next, options);
  return toControlPlaneState(next, options);
}

export async function useControlPlane(
  input: string,
  options: ControlPlanePathOptions = {},
): Promise<ControlPlaneState> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = normalizeControlPlanePath(input, env);
  const file = await readControlPlaneFile(options);
  const key = controlPlanePathKey(home, platform);
  const registered = file.controlPlanes.find(
    (value) => controlPlanePathKey(value, platform) === key,
  );

  if (!registered) {
    throw new SkillinkError(
      'CONTROL_PLANE_NOT_FOUND',
      'Control plane is not registered. Add it first.',
      { path: home },
    );
  }

  const next: ControlPlaneFile = { ...file, active: registered };
  await writeControlPlaneFile(next, options);
  return toControlPlaneState(next, options);
}

export async function resolveControlPlaneHome(
  options: ControlPlanePathOptions = {},
): Promise<{ home: string | null; source: 'env' | 'registry' | null }> {
  const env = options.env ?? process.env;
  const override = getSkillinkHomeOverride(env);
  if (override) {
    return { home: override, source: 'env' };
  }

  const file = await readControlPlaneFile(options);
  return file.active
    ? { home: file.active, source: 'registry' }
    : { home: null, source: null };
}
