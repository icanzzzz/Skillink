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
  const packageFile = await readPackageFile(input.paths);
  const skillFile = await readSkillFile(input.paths);
  const resolved = resolvePackageVersion(
    packageFile,
    input.name,
    input.requested,
  );

  const lock: PackageLock = {
    requested: input.requested,
    resolved: resolved.version,
    integrity: computePackageIntegrity(packageFile, [
      { name: input.name, version: resolved.version },
    ]),
    enabled: true,
  };

  const candidate: TargetRoute = {
    ...target,
    packages: {
      ...target.packages,
      [input.name]: lock,
    },
  };

  resolvePackageGraph(
    packageFile,
    skillFile,
    Object.entries(candidate.packages)
      .filter(([, packageLock]) => packageLock.enabled !== false)
      .map(([name, packageLock]) => ({
        name,
        version: packageLock.resolved,
      })),
  );

  route.targets[targetIndex] = candidate;

  await withHistory(input.paths, 'add-route-entry', async () => {
    await writeRouteFile(input.paths, route);
  });

  return lock;
}

export async function setPackageEnabled(
  paths: SkillinkPaths,
  targetId: string,
  packageName: string,
  enabled: boolean,
): Promise<PackageLock> {
  const route = await readRouteFile(paths);
  const target = findTarget(route, targetId);

  if (!target) {
    throw new SkillinkError(
      'TARGET_NOT_FOUND',
      `Target "${targetId}" does not exist.`,
      { targetId },
    );
  }

  const lock = target.packages[packageName];
  if (!lock) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${packageName}" is not assigned to target "${targetId}".`,
      { targetId, name: packageName },
    );
  }

  lock.enabled = enabled;
  await withHistory(
    paths,
    enabled ? 'enable-route-package' : 'disable-route-package',
    async () => {
      await writeRouteFile(paths, route);
    },
  );

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

  if (!target) {
    throw new SkillinkError(
      'TARGET_NOT_FOUND',
      `Target "${input.targetId}" does not exist.`,
      { targetId: input.targetId },
    );
  }

  if (!(input.name in target.packages)) {
    return false;
  }

  delete target.packages[input.name];

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
          name: input.name,
          cause: error instanceof Error ? error.message : String(error),
        },
        { cause: error },
      );
    }
  }

  await withHistory(input.paths, 'remove-route-entry', async () => {
    await writeRouteFile(input.paths, route);
  });
  return true;
}
