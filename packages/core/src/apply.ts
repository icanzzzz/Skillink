import { lstat, mkdir, readdir, realpath, rmdir, stat } from 'node:fs/promises';
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
  assertSafeRealTargetPath,
  isPathInside,
  isSamePath,
} from './path-policy.js';
import { readRouteFile } from './route.js';
import { readPackageFile } from './package-store.js';
import { assertSkillContent, readSkillFile } from './skill-store.js';
import { assertSkillIntegrity } from './skill-integrity.js';
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

interface PlannedOperation extends ApplyOperation {
  previousSourcePath?: string;
}

interface PlannedTarget {
  target: TargetRoute;
  targetPath: string;
  targetExisted: boolean;
  operations: PlannedOperation[];
  conflicts: ApplyConflict[];
}

type UndoAction =
  | { kind: 'remove-link'; path: string }
  | { kind: 'restore-link'; path: string; target: string }
  | { kind: 'remove-directory'; path: string };

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function inspectTargetDirectory(
  targetPath: string,
): Promise<boolean> {
  const info = await stat(targetPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });

  if (info && !info.isDirectory()) {
    throw new SkillinkError(
      'ROUTE_INVALID',
      `Target path is not a directory: ${targetPath}`,
      { targetPath },
    );
  }

  return info !== undefined;
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

async function planTarget(
  paths: SkillinkPaths,
  packageFile: PackageFile,
  skillFile: Awaited<ReturnType<typeof readSkillFile>>,
  target: TargetRoute,
  prune: boolean,
): Promise<PlannedTarget | undefined> {
  if (!target.enabled) {
    return undefined;
  }

  const targetPath = await assertSafeRealTargetPath(target.path, paths);
  const targetExisted = await inspectTargetDirectory(targetPath);
  const operations: PlannedOperation[] = [];
  const conflicts: ApplyConflict[] = [];

  if (!targetExisted) {
    operations.push({
      kind: 'create-target',
      targetId: target.id,
      targetPath,
      path: targetPath,
    });
  }

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
      'COPY_MODE_UNSUPPORTED',
      'Copy mode is not implemented yet; use mode "link" instead.',
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
    await assertSkillIntegrity(paths, skill.name, skill.version, skill.entry);
    const destination = path.join(targetPath, skill.name);

    const realSourceDir = await realpath(sourceDir).catch(() => sourceDir);
    const realLibraryDir = await realpath(paths.libraryDir).catch(
      () => paths.libraryDir,
    );
    if (
      !isSamePath(realSourceDir, realLibraryDir) &&
      !isPathInside(realSourceDir, realLibraryDir)
    ) {
      throw new SkillinkError(
        'UNSAFE_PATH',
        `Skill source escapes the control plane: ${sourceDir}`,
        {
          skill: skill.name,
          version: skill.version,
          sourceDir,
          realSourceDir,
        },
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
          previousSourcePath: inspection.target,
        });
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

  if (prune) {
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

      const inspection = await inspectPath(entryPath);
      operations.push({
        kind: 'remove-link',
        targetId: target.id,
        targetPath,
        name: entry.name,
        path: entryPath,
        previousSourcePath:
          inspection.kind === 'link' ? inspection.target : undefined,
      });
    }
  }

  return {
    target,
    targetPath,
    targetExisted,
    operations,
    conflicts,
  };
}

async function rollback(undo: UndoAction[]): Promise<unknown[]> {
  const failures: unknown[] = [];

  for (const action of undo.reverse()) {
    try {
      if (action.kind === 'remove-link') {
        await removeLink(action.path).catch((error: unknown) => {
          if (!(isNodeError(error) && error.code === 'ENOENT')) {
            throw error;
          }
        });
        continue;
      }

      if (action.kind === 'remove-directory') {
        await rmdir(action.path).catch((error: unknown) => {
          if (
            !(
              isNodeError(error) &&
              (error.code === 'ENOENT' || error.code === 'ENOTEMPTY')
            )
          ) {
            throw error;
          }
        });
        continue;
      }

      await removeLink(action.path).catch((error: unknown) => {
        if (!(isNodeError(error) && error.code === 'ENOENT')) {
          throw error;
        }
      });
      await mkdir(path.dirname(action.path), { recursive: true });
      await createDirectoryLink(action.target, action.path);
    } catch (error) {
      failures.push(error);
    }
  }

  return failures;
}

async function executePlan(
  paths: SkillinkPaths,
  plans: PlannedTarget[],
): Promise<void> {
  const undo: UndoAction[] = [];

  try {
    for (const plan of plans) {
      if (!plan.targetExisted) {
        await mkdir(plan.targetPath, { recursive: true });
        undo.push({ kind: 'remove-directory', path: plan.targetPath });
      }

      for (const operation of plan.operations) {
        if (operation.kind === 'create-target' || operation.kind === 'skip') {
          continue;
        }

        if (operation.kind === 'create-link') {
          await createDirectoryLink(operation.sourcePath!, operation.path);
          undo.push({ kind: 'remove-link', path: operation.path });
          continue;
        }

        if (operation.kind === 'replace-link') {
          if (operation.previousSourcePath) {
            undo.push({
              kind: 'restore-link',
              path: operation.path,
              target: operation.previousSourcePath,
            });
          }
          await removeLink(operation.path);
          await createDirectoryLink(operation.sourcePath!, operation.path);
          continue;
        }

        if (operation.kind === 'remove-link') {
          if (operation.previousSourcePath) {
            undo.push({
              kind: 'restore-link',
              path: operation.path,
              target: operation.previousSourcePath,
            });
          }
          await removeLink(operation.path);
        }
      }
    }
  } catch (error) {
    const failures = await rollback(undo);
    if (failures.length === 0) {
      throw error;
    }

    throw new SkillinkError(
      'IO_ERROR',
      `Apply failed and rollback was incomplete: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        rollbackFailures: failures.map((failure) =>
          failure instanceof Error ? failure.message : String(failure),
        ),
      },
      { cause: error },
    );
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

  const plans: PlannedTarget[] = [];
  for (const target of selectedTargets) {
    const plan = await planTarget(
      paths,
      packageFile,
      skillFile,
      target,
      input.prune ?? false,
    );
    if (plan) {
      plans.push(plan);
    }
  }

  const operations = plans.flatMap((plan) => plan.operations);
  const conflicts = plans.flatMap((plan) => plan.conflicts);
  const dryRun = input.dryRun ?? false;

  if (!dryRun) {
    await executePlan(paths, plans);
  }

  return {
    dryRun,
    ok: conflicts.length === 0,
    operations,
    conflicts,
  };
}
