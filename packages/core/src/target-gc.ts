import { lstat, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  assertSafeSegment,
  type SkillinkPaths,
  type TargetRoute,
} from '@skillink/shared';
import { withFsRetry } from './fs-retry.js';
import { removeLink } from './links.js';
import { resolvePackageGraph } from './package-graph.js';
import { resolveTargetGraph } from './target-graph.js';
import { readPackageFile } from './package-store.js';
import { readSkillFile } from './skill-store.js';
import { assertSafeRealTargetPath } from './path-policy.js';
import { isNodeError } from './node-error.js';

export interface TargetGcInput {
  paths: SkillinkPaths;
  target: TargetRoute;
}

function ioError(
  message: string,
  details: Record<string, unknown>,
  cause: unknown,
): SkillinkError {
  return new SkillinkError('IO_ERROR', message, details, { cause });
}

export async function resolveTargetSkillNames(
  input: TargetGcInput,
): Promise<string[]> {
  const roots = Object.entries(input.target.packages).map(
    ([name, lock]) => ({ name, version: lock.resolved }),
  );

  if (roots.length === 0) {
    return [];
  }

  const [packageFile, skillFile] = await Promise.all([
    readPackageFile(input.paths),
    readSkillFile(input.paths),
  ]);

  return [
    ...resolveTargetGraph(packageFile, skillFile, input.target, {
      includeDisabledPackages: true,
    }).skills.keys(),
  ].sort();
}

export interface PackageSkillNamesInput {
  paths: SkillinkPaths;
  packageRef: { name: string; version: string };
}

export async function resolvePackageSkillNames(
  input: PackageSkillNamesInput,
): Promise<string[]> {
  const [packageFile, skillFile] = await Promise.all([
    readPackageFile(input.paths),
    readSkillFile(input.paths),
  ]);

  return [
    ...resolvePackageGraph(packageFile, skillFile, [input.packageRef]).skills.keys(),
  ].sort();
}

export async function resolveTargetActiveSkillNames(
  input: TargetGcInput,
): Promise<string[]> {
  if (!input.target.enabled) {
    return [];
  }

  const roots = Object.entries(input.target.packages)
    .filter(([, lock]) => lock.enabled !== false)
    .map(([name, lock]) => ({ name, version: lock.resolved }));

  if (roots.length === 0) {
    return [];
  }

  const [packageFile, skillFile] = await Promise.all([
    readPackageFile(input.paths),
    readSkillFile(input.paths),
  ]);

  return [...resolveTargetGraph(packageFile, skillFile, input.target).skills.keys()].sort();
}

export function subtractSkillNames(
  names: string[],
  keep: Iterable<string>,
): string[] {
  const keepSet = new Set(keep);
  return names.filter((name) => !keepSet.has(name));
}

export interface RemoveObsoleteTargetSkillsInput {
  paths: SkillinkPaths;
  target: TargetRoute;
  previousSkillNames: Iterable<string>;
}

export async function removeObsoleteTargetSkills(
  input: RemoveObsoleteTargetSkillsInput,
): Promise<string[]> {
  const previousSkillNames = [...input.previousSkillNames];
  if (previousSkillNames.length === 0) {
    return [];
  }

  let remainingSkillNames: string[];
  try {
    remainingSkillNames = await resolveTargetActiveSkillNames({
      paths: input.paths,
      target: input.target,
    });
  } catch {
    return [];
  }

  const removedSkills = subtractSkillNames(
    previousSkillNames,
    remainingSkillNames,
  );
  if (removedSkills.length === 0) {
    return [];
  }

  return gcTargetEntries({
    paths: input.paths,
    target: input.target,
    skillNames: removedSkills,
  });
}

export async function gcTargetEntries(
  input: TargetGcInput & { skillNames: string[] },
): Promise<string[]> {
  const skillNames = input.skillNames.map((name) =>
    assertSafeSegment(name, 'skill name'),
  );
  const targetPath = await assertSafeRealTargetPath(
    input.target.path,
    input.paths,
  );

  let targetInfo;
  try {
    targetInfo = await stat(targetPath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw ioError(
      `Failed to inspect target directory ${targetPath}.`,
      { targetId: input.target.id, targetPath, path: targetPath },
      error,
    );
  }

  if (!targetInfo.isDirectory()) {
    return [];
  }

  const removed: string[] = [];

  for (const skillName of skillNames) {
    const entryPath = path.join(targetPath, skillName);
    let info;
    try {
      info = await lstat(entryPath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        continue;
      }
      throw ioError(
        `Failed to inspect target skill ${skillName}.`,
        {
          targetId: input.target.id,
          targetPath,
          skillName,
          path: entryPath,
        },
        error,
      );
    }

    try {
      if (info.isSymbolicLink()) {
        await removeLink(entryPath);
        removed.push(skillName);
        continue;
      }

      if (info.isDirectory()) {
        await withFsRetry(() =>
          rm(entryPath, { recursive: true, force: true }),
        );
        removed.push(skillName);
      }
    } catch (error) {
      throw ioError(
        `Failed to delete target skill ${skillName}.`,
        {
          targetId: input.target.id,
          targetPath,
          skillName,
          path: entryPath,
        },
        error,
      );
    }
  }

  return removed;
}
