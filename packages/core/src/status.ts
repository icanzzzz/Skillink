import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  getSkillDir,
  getSkillinkPaths,
  type SkillinkErrorCode,
  type SkillinkPaths,
  type StatusEntry,
  type StatusReport,
  type StatusState,
} from '@skillink/shared';
import { assertSafeRealTargetPath } from './path-policy.js';
import { compareTargetEntry } from './target-entry.js';
import { readRouteFile } from './route.js';
import { readPackageFile } from './package-store.js';
import { readSkillFile } from './skill-store.js';
import {
  checkTargetPackageLocks,
  resolveTargetGraph,
} from './target-graph.js';
import { isNodeError } from './node-error.js';

export interface StatusInput {
  paths?: SkillinkPaths;
  home?: string;
  targetId?: string;
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
      targetPath = await assertSafeRealTargetPath(target.path, paths);
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

    if (!target.enabled) {
      entries.push({
        targetId: target.id,
        targetPath,
        name: '<target>',
        version: '',
        state: 'disabled',
        path: targetPath,
        detail: 'Target is disabled.',
      });
      continue;
    }

    let targetFailed = false;

    for (const check of checkTargetPackageLocks(packageFile, target)) {
      const error = check.error;
      if (!error) {
        continue;
      }
      entries.push({
        targetId: target.id,
        targetPath,
        name: check.name,
        version: check.lock.resolved,
        state: errorState(error),
        path: path.join(targetPath, check.name),
        packageName: check.name,
        detail: errorDetail(error),
      });
      targetFailed = true;
    }

    if (targetFailed) {
      continue;
    }

    let resolution;
    try {
      resolution = resolveTargetGraph(packageFile, skillFile, target);
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
      const comparison = await compareTargetEntry({
        destination,
        sourcePath,
        mode: target.mode,
        expected: skill.entry,
      });

      if (comparison.kind === 'missing') {
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

      if (comparison.kind === 'ok') {
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

      if (comparison.kind === 'wrong-mode') {
        entries.push({
          targetId: target.id,
          targetPath,
          name: skill.name,
          version: skill.version,
          state: 'wrong-mode',
          path: destination,
          sourcePath,
          detail: `Existing ${comparison.actual.kind} is not a ${target.mode} entry.`,
        });
        continue;
      }

      if (comparison.kind === 'broken-link') {
        entries.push({
          targetId: target.id,
          targetPath,
          name: skill.name,
          version: skill.version,
          state: 'broken-link',
          path: destination,
          sourcePath,
          detail: 'Link target is missing.',
        });
        continue;
      }

      entries.push({
        targetId: target.id,
        targetPath,
        name: skill.name,
        version: skill.version,
        state:
          comparison.kind === 'wrong-version' ? 'wrong-version' : 'conflict',
        path: destination,
        sourcePath,
        detail:
          comparison.kind === 'wrong-version'
            ? `Content does not match ${skill.name}@${skill.version}.`
            : errorDetail(comparison.error),
      });
    }
  }

  return {
    healthy: entries.every(
      (entry) => entry.state === 'ok' || entry.state === 'disabled',
    ),
    entries,
  };
}
