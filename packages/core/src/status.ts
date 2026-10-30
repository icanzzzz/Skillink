import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import { inspectPath, isManagedLink } from './links.js';
import { assertSafeTargetPath, isPathInside, isSamePath } from './path-policy.js';
import { readRouteFile } from './route.js';
import { readSkillsFile } from './library.js';

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

export async function status(input: StatusInput = {}): Promise<StatusReport> {
  const paths = input.paths ?? getSkillinkPaths(input.home);
  const route = await readRouteFile(paths);
  const library = await readSkillsFile(paths);
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
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const desired = new Set(
      Object.entries(target.skills)
        .filter(([, lock]) => lock.enabled !== false)
        .map(([name]) => name),
    );

    for (const [name, lock] of Object.entries(target.skills)) {
      if (lock.enabled === false) {
        entries.push({
          targetId: target.id,
          targetPath,
          name,
          version: lock.resolved,
          state: 'disabled',
          path: path.join(targetPath, name),
        });
        continue;
      }

      const packageEntry = library.packages[name];
      const versionEntry = packageEntry?.versions[lock.resolved];
      if (!packageEntry || !versionEntry) {
        entries.push({
          targetId: target.id,
          targetPath,
          name,
          version: lock.resolved,
          state: 'missing',
          path: path.join(targetPath, name),
          detail: 'Package version is missing from skills.json.',
        });
        continue;
      }

      const sourcePath = path.resolve(paths.home, versionEntry.source);
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
          name,
          version: lock.resolved,
          state: 'missing',
          path: path.join(targetPath, name),
          sourcePath,
          detail: 'Library content is missing.',
        });
        continue;
      }

      const destination = path.join(targetPath, name);
      const inspection = await inspectPath(destination);

      if (inspection.kind === 'missing') {
        entries.push({
          targetId: target.id,
          targetPath,
          name,
          version: lock.resolved,
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
            name,
            version: lock.resolved,
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
            name,
            version: lock.resolved,
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
          name,
          version: lock.resolved,
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
        name,
        version: lock.resolved,
        state: 'conflict',
        path: destination,
        sourcePath,
        detail: `Existing ${inspection.kind} is not a managed link.`,
      });
    }

    const children = await readdir(targetPath, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return [];
        }
        throw error;
      },
    );

    for (const child of children) {
      if (desired.has(child.name)) {
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
