import semver from 'semver';
import {
  RouteFileSchema,
  SkillinkError,
  createEmptyRouteFile,
  type LibraryVersion,
  type RouteFile,
  type SkillLock,
  type SkillinkPaths,
  type SkillsFile,
  type TargetRoute,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';
import { readSkillsFile } from './library.js';
import { withHistory } from './history.js';

export async function readRouteFile(paths: SkillinkPaths): Promise<RouteFile> {
  return readJsonFile(paths.routeFile, RouteFileSchema, createEmptyRouteFile());
}

export async function writeRouteFile(
  paths: SkillinkPaths,
  file: RouteFile,
): Promise<void> {
  await writeJsonAtomic(paths.routeFile, file, RouteFileSchema);
}

export function findTarget(
  route: RouteFile,
  targetId: string,
): TargetRoute | undefined {
  return route.targets.find((target) => target.id === targetId);
}

export interface ResolvedLibraryVersion {
  version: string;
  entry: LibraryVersion;
}

export function resolveLibraryVersion(
  library: SkillsFile,
  name: string,
  requested: string,
): ResolvedLibraryVersion {
  const packageEntry = library.packages[name];

  if (!packageEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${name}" is not in the public library.`,
      { name },
    );
  }

  const versions = Object.keys(packageEntry.versions);
  const taggedVersion = packageEntry.tags?.[requested];
  const directVersion = packageEntry.versions[requested] ? requested : undefined;
  const rangeVersion =
    taggedVersion || directVersion
      ? undefined
      : semver.maxSatisfying(versions, requested);

  const resolved = taggedVersion ?? directVersion ?? rangeVersion;

  if (!resolved) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${requested}" of package "${name}" is not available.`,
      { name, requested, available: versions },
    );
  }

  const entry = packageEntry.versions[resolved];
  if (!entry) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${resolved}" of package "${name}" is missing from skills.json.`,
      { name, resolved },
    );
  }

  return { version: resolved, entry };
}

export interface AddRouteEntryInput {
  paths: SkillinkPaths;
  targetId: string;
  name: string;
  requested: string;
}

export async function addRouteEntry(
  input: AddRouteEntryInput,
): Promise<SkillLock> {
  const route = await readRouteFile(input.paths);
  const target = findTarget(route, input.targetId);

  if (!target) {
    throw new SkillinkError(
      'TARGET_NOT_FOUND',
      `Target "${input.targetId}" does not exist.`,
      { targetId: input.targetId },
    );
  }

  const library = await readSkillsFile(input.paths);
  const resolved = resolveLibraryVersion(library, input.name, input.requested);

  const lock: SkillLock = {
    requested: input.requested,
    resolved: resolved.version,
    integrity: resolved.entry.integrity,
    source: resolved.entry.source,
    enabled: true,
  };

  target.skills[input.name] = lock;
  await withHistory(input.paths, 'add-route-entry', async () => {
    await writeRouteFile(input.paths, route);
  });

  return lock;
}

export interface RemoveRouteEntryInput {
  paths: SkillinkPaths;
  targetId: string;
  name: string;
}

export async function removeRouteEntry(
  input: RemoveRouteEntryInput,
): Promise<boolean> {
  const route = await readRouteFile(input.paths);
  const target = findTarget(route, input.targetId);

  if (!target) {
    throw new SkillinkError(
      'TARGET_NOT_FOUND',
      `Target "${input.targetId}" does not exist.`,
      { targetId: input.targetId },
    );
  }

  if (!(input.name in target.skills)) {
    return false;
  }

  delete target.skills[input.name];
  await withHistory(input.paths, 'remove-route-entry', async () => {
    await writeRouteFile(input.paths, route);
  });
  return true;
}
