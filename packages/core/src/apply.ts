import { lstat, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  assertSafeSegment,
  assertSafeVersion,
  getSkillinkPaths,
  type PackageFile,
  type SkillinkPaths,
  type TargetRoute,
} from '@skillink/shared';
import {
  createDirectoryLink,
  inspectPath,
  isManagedLink,
  removeLink,
} from './links.js';
import {
  assertSafeTargetPath,
  isPathInside,
  isSamePath,
} from './path-policy.js';
import { readRouteFile } from './route.js';
import { readPackageFile } from './package-store.js';
import { assertSkillContent, readSkillFile } from './skill-store.js';
import {
  computePackageIntegrity,
  resolvePackageGraph,
} from './package-graph.js';

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

async function validatePackageLocks(
  packageFile: PackageFile,
  target: TargetRoute,
): Promise<void> {
  for (const [name, lock] of Object.entries(target.packages)) {
    if (lock.enabled === false) {
      continue;
    }

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
  }
}

export async function apply(input: ApplyInput = {}): Promise<ApplyReport> {
  const paths = input.paths ?? getSkillinkPaths(input.home);
  const route = await readRouteFile(paths);
  const packageFile = await readPackageFile(paths);
  const skillFile = await readSkillFile(paths);
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
    await validatePackageLocks(packageFile, target);

    const roots = Object.entries(target.packages)
      .filter(([, lock]) => lock.enabled !== false)
      .map(([name, lock]) => ({ name, version: lock.resolved }));
    const resolution = resolvePackageGraph(packageFile, skillFile, roots);
    const desired = new Map(
      [...resolution.skills.values()].map((skill) => [skill.name, skill]),
    );

    if (target.mode !== 'link' && desired.size > 0) {
      throw new SkillinkError(
        'LINK_FAILED',
        'Copy mode is not implemented in the MVP yet.',
        { targetId: target.id, mode: target.mode },
      );
    }

    for (const skill of desired.values()) {
      assertSafeSegment(skill.name, 'skill name');
      assertSafeVersion(skill.version, 'skill version');
      const sourceDir = await assertSkillContent(
        paths,
        skill.name,
        skill.version,
      );
      const destination = path.join(targetPath, skill.name);

      if (
        !isSamePath(sourceDir, paths.libraryDir) &&
        !isPathInside(sourceDir, paths.libraryDir)
      ) {
        throw new SkillinkError(
          'UNSAFE_PATH',
          `Skill source escapes the control plane: ${sourceDir}`,
          { skill: skill.name, version: skill.version, sourceDir },
        );
      }
      if (!isPathInside(destination, targetPath)) {
        throw new SkillinkError(
          'UNSAFE_PATH',
          `Skill destination escapes the target: ${destination}`,
          { skill: skill.name, targetPath, destination },
        );
      }

      const inspection = await inspectPath(destination);

      if (inspection.kind === 'missing') {
        operations.push({
          kind: 'create-link',
          targetId: target.id,
          targetPath,
          name: skill.name,
          version: skill.version,
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
            name: skill.name,
            version: skill.version,
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
            name: skill.name,
            version: skill.version,
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
        name: skill.name,
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
