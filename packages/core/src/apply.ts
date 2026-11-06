import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  assertSafeSegment,
  assertSafeVersion,
  type ApplyOperation,
  type ApplyReport,
  type PackageFile,
  type SkillVersion,
  type SkillinkPaths,
  type TargetRoute,
} from '@skillink/shared';
import { copySkillDirectory } from './copy.js';
import { createDirectoryLink, removeLink } from './links.js';
import { withFsRetry } from './fs-retry.js';
import { compareTargetEntry } from './target-entry.js';
import {
  assertSafeRealTargetPath,
  isPathInside,
  isSamePath,
} from './path-policy.js';
import { readRouteFile } from './route.js';
import { readPackageFile } from './package-store.js';
import { assertSkillContent, readSkillFile } from './skill-store.js';
import { assertSkillIntegrity } from './skill-integrity.js';
import { resolveTarget } from './target-graph.js';
import { isNodeError } from './node-error.js';
import { resolveSkillinkPaths } from './paths.js';

export interface ApplyInput {
  paths?: SkillinkPaths;
  home?: string;
  targetId?: string;
  dryRun?: boolean;
}

interface PlannedOperation extends ApplyOperation {
  expected?: SkillVersion;
  previousSourcePath?: string;
  previousKind?: 'link' | 'directory' | 'file' | 'other';
}

interface PlannedTarget {
  target: TargetRoute;
  targetPath: string;
  targetExisted: boolean;
  operations: PlannedOperation[];
}

function toPublicOperation(operation: PlannedOperation): ApplyOperation {
  const {
    expected: _expected,
    previousKind: _previousKind,
    previousSourcePath: _previousSourcePath,
    ...publicOperation
  } = operation;
  return publicOperation;
}

type UndoAction =
  | { kind: 'remove-link'; path: string }
  | { kind: 'restore-link'; path: string; target: string }
  | { kind: 'remove-tree'; path: string }
  | { kind: 'remove-directory'; path: string };

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

async function planTarget(
  paths: SkillinkPaths,
  packageFile: PackageFile,
  skillFile: Awaited<ReturnType<typeof readSkillFile>>,
  target: TargetRoute,
): Promise<PlannedTarget | undefined> {
  if (!target.enabled) {
    return undefined;
  }

  const targetPath = await assertSafeRealTargetPath(target.path, paths);
  const targetExisted = await inspectTargetDirectory(targetPath);
  const operations: PlannedOperation[] = [];

  if (!targetExisted) {
    operations.push({
      kind: 'create-target',
      targetId: target.id,
      targetPath,
      path: targetPath,
    });
  }

  const resolution = resolveTarget(packageFile, skillFile, target);
  const desired = new Map(
    [...resolution.skills.values()].map((skill) => [skill.name, skill]),
  );

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

    const comparison = await compareTargetEntry({
      destination,
      sourcePath: sourceDir,
      mode: target.mode,
      expected: skill.entry,
    });

    if (comparison.kind === 'missing') {
      operations.push({
        kind: target.mode === 'copy' ? 'create-copy' : 'create-link',
        targetId: target.id,
        targetPath,
        name: skill.name,
        version: skill.version,
        path: destination,
        sourcePath: sourceDir,
        expected: skill.entry,
      });
      continue;
    }

    if (comparison.kind === 'ok') {
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

    if (comparison.kind === 'error') {
      throw comparison.error;
    }

    operations.push({
      kind: target.mode === 'copy' ? 'replace-copy' : 'replace-link',
      targetId: target.id,
      targetPath,
      name: skill.name,
      version: skill.version,
      path: destination,
      sourcePath: sourceDir,
      expected: skill.entry,
      previousKind:
        comparison.actual.kind === 'missing'
          ? 'other'
          : comparison.actual.kind,
      previousSourcePath:
        comparison.actual.kind === 'link'
          ? comparison.actual.target
          : undefined,
    });
  }

  return {
    target,
    targetPath,
    targetExisted,
    operations,
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

      if (action.kind === 'remove-tree') {
        await withFsRetry(() =>
          rm(action.path, { recursive: true, force: true }),
        );
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

function operationDetails(operation: PlannedOperation): Record<string, unknown> {
  return {
    targetId: operation.targetId,
    targetPath: operation.targetPath,
    skill: operation.name,
    version: operation.version,
    sourcePath: operation.sourcePath,
    destination: operation.path,
  };
}

async function stageCopy(
  operation: PlannedOperation,
  targetPath: string,
  undo: UndoAction[],
): Promise<string> {
  const temporaryPath = path.join(
    targetPath,
    `.skillink-tmp-${randomUUID()}`,
  );
  await copySkillDirectory(
    operation.sourcePath!,
    temporaryPath,
    operation.expected!,
    {
      targetId: operation.targetId,
      targetPath,
      skill: operation.name,
      version: operation.version,
    },
  );
  undo.push({ kind: 'remove-tree', path: temporaryPath });
  return temporaryPath;
}

async function moveStagedCopy(
  operation: PlannedOperation,
  temporaryPath: string,
): Promise<void> {
  try {
    await withFsRetry(() => rename(temporaryPath, operation.path));
  } catch (error) {
    throw new SkillinkError(
      'IO_ERROR',
      `Failed to move the copied skill into place: ${operation.path}`,
      { ...operationDetails(operation), temporaryPath },
      { cause: error },
    );
  }
}

async function removeExistingEntry(operation: PlannedOperation): Promise<void> {
  try {
    if (operation.previousKind === 'link') {
      await removeLink(operation.path);
    } else {
      await withFsRetry(() =>
        rm(operation.path, { recursive: true, force: true }),
      );
    }
  } catch (error) {
    throw new SkillinkError(
      'IO_ERROR',
      `Failed to remove the existing target entry: ${operation.path}`,
      operationDetails(operation),
      { cause: error },
    );
  }
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
          await removeExistingEntry(operation);
          await createDirectoryLink(operation.sourcePath!, operation.path);
          continue;
        }

        if (operation.kind === 'create-copy') {
          const temporaryPath = await stageCopy(
            operation,
            plan.targetPath,
            undo,
          );
          await moveStagedCopy(operation, temporaryPath);
          undo.push({ kind: 'remove-tree', path: operation.path });
          continue;
        }

        if (operation.kind === 'replace-copy') {
          const temporaryPath = await stageCopy(
            operation,
            plan.targetPath,
            undo,
          );
          if (operation.previousSourcePath) {
            undo.push({
              kind: 'restore-link',
              path: operation.path,
              target: operation.previousSourcePath,
            });
          }
          await removeExistingEntry(operation);
          await moveStagedCopy(operation, temporaryPath);
          undo.push({ kind: 'remove-tree', path: operation.path });
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
  const paths = resolveSkillinkPaths(input);
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
    const plan = await planTarget(paths, packageFile, skillFile, target);
    if (plan) {
      plans.push(plan);
    }
  }

  const operations = plans.flatMap((plan) =>
    plan.operations.map(toPublicOperation),
  );
  const dryRun = input.dryRun ?? false;

  if (!dryRun) {
    await executePlan(paths, plans);
  }

  return {
    dryRun,
    ok: true,
    operations,
  };
}
