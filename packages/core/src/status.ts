import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  getSkillDir,
  getSkillinkPaths,
  type SkillinkErrorCode,
  type SkillinkPaths,
} from '@skillink/shared';
import { inspectPath, isManagedLink } from './links.js';
import {
  assertSafeTargetPath,
  isPathInside,
  isSamePath,
} from './path-policy.js';
import { readRouteFile } from './route.js';
import { readPackageFile } from './package-store.js';
import { readSkillFile } from './skill-store.js';
import {
  computePackageIntegrity,
  resolvePackageGraph,
} from './package-graph.js';

export type StatusState =
  | 'ok'
  | 'missing'
  | 'wrong-version'
  | 'broken-link'
  | 'conflict'
  | 'unmanaged'
  | 'extra'
  | 'disabled';

export interface StatusEntry {
  targetId: string;
  targetPath: string;
  name: string;
  version: string;
  state: StatusState;
  path: string;
  sourcePath?: string;
  packageName?: string;
  detail?: string;
}

export interface StatusReport {
  healthy: boolean;
  entries: StatusEntry[];
}

export interface StatusInput {
  paths?: SkillinkPaths;
  home?: string;
  targetId?: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function errorCode(error: unknown): SkillinkErrorCode | undefined {
  return error instanceof SkillinkError ? error.code : undefined;
}

function errorState(
  error: unknown,
): 'missing' | 'conflict' {
  const code = errorCode(error);
  return code === 'PACKAGE_NOT_FOUND' || code === 'VERSION_NOT_FOUND'
    ? 'missing'
    : 'conflict';
}

function errorDetail(error: unknown): string {
  if (error instanceof SkillinkError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function status(input: StatusInput = {}): Promise<StatusReport> {
  const paths = input.paths ?? getSkillinkPaths(input.home);
  const route = await readRouteFile(paths);
  const packageFile = await readPackageFile(paths);
  const skillFile = await readSkillFile(paths);
  const entries: StatusEntry[] = [];
  const targets = input.targetId
    ? route.targets.filter((target) => target.id === input.targetId)
    : route.targets;

  for (const target of targets) {
    let targetPath: string;
    try {
      targetPath = assertSafeTargetPath(target.path, paths);
    } catch (error) {
      entries.push({
        targetId: target.id,
        targetPath: target.path,
        name: '<target>',
        version: '',
        state: 'conflict',
        path: target.path,
        detail: errorDetail(error),
      });
      continue;
    }

    for (const [name, lock] of Object.entries(target.packages)) {
      if (lock.enabled === false) {
        entries.push({
          targetId: target.id,
          targetPath,
          name,
          version: lock.resolved,
          state: 'disabled',
          path: path.join(targetPath, name),
          packageName: name,
        });
      }
    }

    const enabledLocks = Object.entries(target.packages).filter(
      ([, lock]) => lock.enabled !== false,
    );
    let targetFailed = false;

    for (const [name, lock] of enabledLocks) {
      try {
        const expected = computePackageIntegrity(packageFile, [
          { name, version: lock.resolved },
        ]);
        if (expected !== lock.integrity) {
          throw new SkillinkError(
            'PACKAGE_INTEGRITY_MISMATCH',
            `Route lock for ${name}@${lock.resolved} does not match package.json.`,
            { name, version: lock.resolved, expected, actual: lock.integrity },
          );
        }
      } catch (error) {
        entries.push({
          targetId: target.id,
          targetPath,
          name,
          version: lock.resolved,
          state: errorState(error),
          path: path.join(targetPath, name),
          packageName: name,
          detail: errorDetail(error),
        });
        targetFailed = true;
      }
    }

    if (targetFailed) {
      continue;
    }

    let resolution;
    try {
      resolution = resolvePackageGraph(
        packageFile,
        skillFile,
        enabledLocks.map(([name, lock]) => ({
          name,
          version: lock.resolved,
        })),
      );
    } catch (error) {
      entries.push({
        targetId: target.id,
        targetPath,
        name: '<package>',
        version: '',
        state: errorState(error),
        path: targetPath,
        detail: errorDetail(error),
      });
      continue;
    }

    for (const skill of resolution.skills.values()) {
      const sourcePath = getSkillDir(paths, skill.name, skill.version);
      const sourceExists = await stat(sourcePath)
        .then((info) => info.isDirectory())
        .catch((error: unknown) => {
          if (isNodeError(error) && error.code === 'ENOENT') {
            return false;
          }
          throw error;
        });

      if (!sourceExists) {
        entries.push({
          targetId: target.id,
          targetPath,
          name: skill.name,
          version: skill.version,
          state: 'missing',
          path: path.join(targetPath, skill.name),
          sourcePath,
          detail: 'Skill content is missing.',
        });
        continue;
      }

      const destination = path.join(targetPath, skill.name);
      const inspection = await inspectPath(destination);

      if (inspection.kind === 'missing') {
        entries.push({
          targetId: target.id,
          targetPath,
          name: skill.name,
          version: skill.version,
          state: 'missing',
          path: destination,
          sourcePath,
        });
        continue;
      }

      if (inspection.kind === 'link') {
        if (isSamePath(inspection.target, sourcePath)) {
          entries.push({
            targetId: target.id,
            targetPath,
            name: skill.name,
            version: skill.version,
            state: 'ok',
            path: destination,
            sourcePath,
          });
          continue;
        }

        if (
          isPathInside(inspection.target, paths.libraryDir) ||
          isSamePath(inspection.target, paths.libraryDir)
        ) {
          entries.push({
            targetId: target.id,
            targetPath,
            name: skill.name,
            version: skill.version,
            state: 'wrong-version',
            path: destination,
            sourcePath,
            detail: `Link points to ${inspection.target}.`,
          });
          continue;
        }

        entries.push({
          targetId: target.id,
          targetPath,
          name: skill.name,
          version: skill.version,
          state: 'unmanaged',
          path: destination,
          sourcePath,
          detail: `Link points outside the library: ${inspection.target}.`,
        });
        continue;
      }

      entries.push({
        targetId: target.id,
        targetPath,
        name: skill.name,
        version: skill.version,
        state: 'conflict',
        path: destination,
        sourcePath,
        detail: `Existing ${inspection.kind} is not a managed link.`,
      });
    }

    const desiredNames = new Set(resolution.skills.keys());
    const children = await readdir(targetPath, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return [];
        }
        throw error;
      },
    );

    for (const child of children) {
      if (desiredNames.has(child.name)) {
        continue;
      }

      const childPath = path.join(targetPath, child.name);
      const info = await lstat(childPath);
      if (!info.isSymbolicLink()) {
        continue;
      }

      if (await isManagedLink(childPath, paths)) {
        entries.push({
          targetId: target.id,
          targetPath,
          name: child.name,
          version: '',
          state: 'extra',
          path: childPath,
          detail: 'Managed link is not present in route.json.',
        });
      }
    }
  }

  return {
    healthy: entries.every(
      (entry) => entry.state === 'ok' || entry.state === 'disabled',
    ),
    entries,
  };
}
