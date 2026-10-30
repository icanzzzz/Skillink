import { lstat, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  getSkillinkPaths,
  type SkillinkPaths,
  type TargetRoute,
} from '@skillink/shared';
import {
  createDirectoryLink,
  inspectPath,
  isManagedLink,
  removeLink,
} from './links.js';
import { assertSafeTargetPath, isPathInside, isSamePath } from './path-policy.js';
import { findTarget, readRouteFile } from './route.js';
import { readSkillsFile } from './library.js';

export type ApplyOperationKind =
  | 'create-target'
  | 'create-link'
  | 'replace-link'
  | 'remove-link'
  | 'skip';

export interface ApplyOperation {
  kind: ApplyOperationKind;
  targetId: string;
  targetPath: string;
  name?: string;
  version?: string;
  path: string;
  sourcePath?: string;
}

export interface ApplyConflict {
  targetId: string;
  name: string;
  path: string;
  reason: string;
}

export interface ApplyReport {
  dryRun: boolean;
  ok: boolean;
  operations: ApplyOperation[];
  conflicts: ApplyConflict[];
}

export interface ApplyInput {
  paths?: SkillinkPaths;
  home?: string;
  targetId?: string;
  dryRun?: boolean;
  prune?: boolean;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function ensureTargetDirectory(
  targetPath: string,
  dryRun: boolean,
): Promise<void> {
  try {
    const info = await stat(targetPath);
    if (!info.isDirectory()) {
      throw new SkillinkError(
        'ROUTE_INVALID',
        `Target path is not a directory: ${targetPath}`,
        { targetPath },
      );
    }
    return;
  } catch (error) {
    if (!(isNodeError(error) && error.code === 'ENOENT')) {
      throw error;
    }
  }

  if (!dryRun) {
    await mkdir(targetPath, { recursive: true });
  }
}

async function validateRouteSkill(
  paths: SkillinkPaths,
  target: TargetRoute,
  name: string,
): Promise<{ version: string; sourceDir: string }> {
  const library = await readSkillsFile(paths);
  const lock = target.skills[name];

  if (!lock) {
    throw new SkillinkError(
      'ROUTE_INVALID',
      `Missing route lock for ${name} in target ${target.id}.`,
      { targetId: target.id, name },
    );
  }

  const packageEntry = library.packages[name];
  if (!packageEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${name}" is not in the public library.`,
      { name },
    );
  }

  const entry = packageEntry.versions[lock.resolved];
  if (!entry) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${lock.resolved}" of package "${name}" is missing from skills.json.`,
      { name, version: lock.resolved },
    );
  }

  if (entry.integrity !== lock.integrity || entry.source !== lock.source) {
    throw new SkillinkError(
      'ROUTE_INVALID',
      `Route lock for ${name}@${lock.resolved} does not match skills.json.`,
      { name, version: lock.resolved },
    );
  }

  const sourceDir = path.resolve(paths.home, entry.source);
  if (
    !isSamePath(sourceDir, paths.libraryDir) &&
    !isPathInside(sourceDir, paths.libraryDir)
  ) {
    throw new SkillinkError(
      'ROUTE_INVALID',
      `Library source escapes the control plane: ${entry.source}`,
      { name, version: lock.resolved, source: entry.source },
    );
  }

  const sourceStat = await stat(sourceDir).catch((error: unknown) => {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Package content is missing: ${name}@${lock.resolved}`,
      { name, version: lock.resolved, sourceDir },
      { cause: error },
    );
  });

  if (!sourceStat.isDirectory()) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Package content is not a directory: ${name}@${lock.resolved}`,
      { name, version: lock.resolved, sourceDir },
    );
  }

  return { version: lock.resolved, sourceDir };
}

export async function apply(input: ApplyInput = {}): Promise<ApplyReport> {
  const paths = input.paths ?? getSkillinkPaths(input.home);
  const route = await readRouteFile(paths);
  const selectedTargets = input.targetId
    ? route.targets.filter((target) => target.id === input.targetId)
    : route.targets;

  if (input.targetId && selectedTargets.length === 0) {
    throw new SkillinkError(
      'TARGET_NOT_FOUND',
      `Target "${input.targetId}" does not exist.`,
      { targetId: input.targetId },
    );
  }

  const operations: ApplyOperation[] = [];
  const conflicts: ApplyConflict[] = [];

  for (const target of selectedTargets) {
    if (!target.enabled) {
      continue;
    }

    const targetPath = assertSafeTargetPath(target.path, paths);
    const targetExisted = await stat(targetPath)
      .then((info) => info.isDirectory())
      .catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return false;
        }
        throw error;
      });

    if (!targetExisted) {
      operations.push({
        kind: 'create-target',
        targetId: target.id,
        targetPath,
        path: targetPath,
      });
    }

    await ensureTargetDirectory(targetPath, input.dryRun ?? false);

    const desired = new Set(
      Object.entries(target.skills)
        .filter(([, lock]) => lock.enabled !== false)
        .map(([name]) => name),
    );

    for (const name of desired) {
      if (target.mode !== 'link') {
        throw new SkillinkError(
          'LINK_FAILED',
          'Copy mode is not implemented in the MVP yet.',
          { targetId: target.id, name, mode: target.mode },
        );
      }

      const { version, sourceDir } = await validateRouteSkill(paths, target, name);
      const destination = path.join(targetPath, name);
      const inspection = await inspectPath(destination);

      if (inspection.kind === 'missing') {
        operations.push({
          kind: 'create-link',
          targetId: target.id,
          targetPath,
          name,
          version,
          path: destination,
          sourcePath: sourceDir,
        });
        if (!input.dryRun) {
          await createDirectoryLink(sourceDir, destination);
        }
        continue;
      }

      if (inspection.kind === 'link') {
        if (isSamePath(inspection.target, sourceDir)) {
          operations.push({
            kind: 'skip',
            targetId: target.id,
            targetPath,
            name,
            version,
            path: destination,
            sourcePath: sourceDir,
          });
          continue;
        }

        if (await isManagedLink(destination, paths)) {
          operations.push({
            kind: 'replace-link',
            targetId: target.id,
            targetPath,
            name,
            version,
            path: destination,
            sourcePath: sourceDir,
          });
          if (!input.dryRun) {
            await removeLink(destination);
            await createDirectoryLink(sourceDir, destination);
          }
          continue;
        }
      }

      conflicts.push({
        targetId: target.id,
        name,
        path: destination,
        reason:
          inspection.kind === 'link'
            ? 'Existing link is not managed by Skillink.'
            : `Existing ${inspection.kind} is not a managed link.`,
      });
    }

    if (input.prune) {
      const entries = await readdir(targetPath, { withFileTypes: true }).catch(
        (error: unknown) => {
          if (isNodeError(error) && error.code === 'ENOENT') {
            return [];
          }
          throw error;
        },
      );

      for (const entry of entries) {
        if (desired.has(entry.name)) {
          continue;
        }

        const entryPath = path.join(targetPath, entry.name);
        const info = await lstat(entryPath);
        if (!info.isSymbolicLink()) {
          continue;
        }

        if (!(await isManagedLink(entryPath, paths))) {
          continue;
        }

        operations.push({
          kind: 'remove-link',
          targetId: target.id,
          targetPath,
          name: entry.name,
          path: entryPath,
        });
        if (!input.dryRun) {
          await removeLink(entryPath);
        }
      }
    }
  }

  return {
    dryRun: input.dryRun ?? false,
    ok: conflicts.length === 0,
    operations,
    conflicts,
  };
}
