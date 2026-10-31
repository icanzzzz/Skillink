import {
  RouteFileSchema,
  SkillinkError,
  createEmptyRouteFile,
  type PackageLock,
  type RouteFile,
  type SkillinkPaths,
  type TargetRoute,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';
import { readPackageFile, resolvePackageVersion } from './package-store.js';
import { readSkillFile } from './skill-store.js';
import {
  computePackageIntegrity,
  resolvePackageGraph,
} from './package-graph.js';
import { assertSafePackageName } from './package-name.js';
import {
  removeObsoleteTargetSkills,
  resolvePackageSkillNames,
} from './target-gc.js';
import {
  assertTargetPackageLocks,
  resolveTargetGraph,
} from './target-graph.js';

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

export interface AddRouteEntryInput {
  paths: SkillinkPaths;
  targetId: string;
  name: string;
  requested: string;
}

export async function addRouteEntry(
  input: AddRouteEntryInput,
): Promise<PackageLock> {
  const route = await readRouteFile(input.paths);
  const targetIndex = route.targets.findIndex(
    (target) => target.id === input.targetId,
  );

  if (targetIndex === -1) {
    throw new SkillinkError(
      'TARGET_NOT_FOUND',
      `Target "${input.targetId}" does not exist.`,
      { targetId: input.targetId },
    );
  }

  const target = route.targets[targetIndex]!;
  const name = assertSafePackageName(input.name);
  const packageFile = await readPackageFile(input.paths);
  const skillFile = await readSkillFile(input.paths);
  const resolved = resolvePackageVersion(packageFile, name, input.requested);
  const previousLock = target.packages[name];
  const previousSkills = previousLock
    ? await resolvePackageSkillNames({
        paths: input.paths,
        packageRef: { name, version: previousLock.resolved },
      }).catch(() => [])
    : [];

  const lock: PackageLock = {
    requested: input.requested,
    resolved: resolved.version,
    integrity: computePackageIntegrity(packageFile, [
      { name, version: resolved.version },
    ]),
    enabled: true,
  };

  const candidate: TargetRoute = {
    ...target,
    packages: {
      ...target.packages,
      [name]: lock,
    },
  };

  resolvePackageGraph(
    packageFile,
    skillFile,
    Object.entries(candidate.packages)
      .filter(([, packageLock]) => packageLock.enabled !== false)
      .map(([packageName, packageLock]) => ({
        name: packageName,
        version: packageLock.resolved,
      })),
  );

  route.targets[targetIndex] = candidate;

  await removeObsoleteTargetSkills({
    paths: input.paths,
    target: candidate,
    previousSkillNames: previousSkills,
  });
  await writeRouteFile(input.paths, route);

  return lock;
}

export async function validateTargetRoute(
  paths: SkillinkPaths,
  target: TargetRoute,
): Promise<void> {
  const packageFile = await readPackageFile(paths);
  const skillFile = await readSkillFile(paths);

  assertTargetPackageLocks(packageFile, target);
  resolveTargetGraph(packageFile, skillFile, target);
}

export async function setPackageEnabled(
  paths: SkillinkPaths,
  targetId: string,
  packageName: string,
  enabled: boolean,
): Promise<PackageLock> {
  const route = await readRouteFile(paths);
  const target = findTarget(route, targetId);
  const name = assertSafePackageName(packageName);

  if (!target) {
    throw new SkillinkError(
      'TARGET_NOT_FOUND',
      `Target "${targetId}" does not exist.`,
      { targetId },
    );
  }

  if (!Object.hasOwn(target.packages, name)) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${name}" is not assigned to target "${targetId}".`,
      { targetId, name },
    );
  }

  const lock = target.packages[name]!;
  const wasEnabled = lock.enabled !== false;
  const removedSkills =
    !enabled && wasEnabled && target.enabled
      ? await resolvePackageSkillNames({
          paths,
          packageRef: { name, version: lock.resolved },
        }).catch(() => [])
      : [];

  lock.enabled = enabled;
  if (enabled) {
    await validateTargetRoute(paths, target);
  }

  if (!enabled && removedSkills.length > 0) {
    await removeObsoleteTargetSkills({
      paths,
      target,
      previousSkillNames: removedSkills,
    });
  }

  await writeRouteFile(paths, route);

  return lock;
}

export interface RemoveRouteEntryInput {
  paths: SkillinkPaths;
  targetId: string;
  name: string;
  force?: boolean;
}

export async function removeRouteEntry(
  input: RemoveRouteEntryInput,
): Promise<boolean> {
  const route = await readRouteFile(input.paths);
  const target = findTarget(route, input.targetId);
  const name = assertSafePackageName(input.name);

  if (!target) {
    throw new SkillinkError(
      'TARGET_NOT_FOUND',
      `Target "${input.targetId}" does not exist.`,
      { targetId: input.targetId },
    );
  }

  if (!Object.hasOwn(target.packages, name)) {
    return false;
  }

  const removedLock = target.packages[name]!;
  const removedSkills = await resolvePackageSkillNames({
    paths: input.paths,
    packageRef: { name, version: removedLock.resolved },
  }).catch(() => []);

  delete target.packages[name];

  if (!input.force) {
    const packageFile = await readPackageFile(input.paths);
    const skillFile = await readSkillFile(input.paths);
    const roots = Object.entries(target.packages)
      .filter(([, lock]) => lock.enabled !== false)
      .map(([name, lock]) => ({ name, version: lock.resolved }));

    try {
      resolvePackageGraph(packageFile, skillFile, roots);
    } catch (error) {
      throw new SkillinkError(
        'ROUTE_INVALID',
        `Cannot remove route "${input.name}" from target "${input.targetId}" because the remaining graph is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          targetId: input.targetId,
          name,
          cause: error instanceof Error ? error.message : String(error),
        },
        { cause: error },
      );
    }
  }

  await removeObsoleteTargetSkills({
    paths: input.paths,
    target,
    previousSkillNames: removedSkills,
  });
  await writeRouteFile(input.paths, route);
  return true;
}
