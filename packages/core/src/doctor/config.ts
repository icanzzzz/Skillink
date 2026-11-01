import { SkillinkError, type DoctorIssue } from '@skillink/shared';
import {
  assertSafeRealTargetPath,
  isPathInside,
  isSamePath,
} from '../path-policy.js';
import { findCaseInsensitiveDuplicates } from '../package-name.js';
import type { DoctorContext } from './issues.js';

export async function checkTargetConfiguration(
  ctx: DoctorContext,
): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];

  for (const [first, second] of findCaseInsensitiveDuplicates(
    Object.keys(ctx.packageFile.packages),
  )) {
    issues.push({
      code: 'INVALID_CONFIG',
      message: `Package names collide case-insensitively: ${first} / ${second}`,
      name: second,
    });
  }

  for (const [first, second] of findCaseInsensitiveDuplicates(
    Object.keys(ctx.skillFile.skills),
  )) {
    issues.push({
      code: 'INVALID_CONFIG',
      message: `Skill names collide case-insensitively: ${first} / ${second}`,
      name: second,
    });
  }

  for (const [first, second] of findCaseInsensitiveDuplicates(
    ctx.route.targets.map((target) => target.id),
  )) {
    issues.push({
      code: 'INVALID_CONFIG',
      message: `Target ids collide case-insensitively: ${first} / ${second}`,
      targetId: second,
    });
  }

  const targetIds = new Set<string>();
  const resolvedTargetPaths: string[] = [];
  for (const target of ctx.route.targets) {
    if (targetIds.has(target.id)) {
      issues.push({
        code: 'INVALID_CONFIG',
        message: `Duplicate target id: ${target.id}`,
        targetId: target.id,
      });
    }
    targetIds.add(target.id);

    let resolvedTargetPath: string;
    try {
      resolvedTargetPath = await assertSafeRealTargetPath(
        target.path,
        ctx.paths,
      );
    } catch (error) {
      issues.push({
        code:
          error instanceof SkillinkError && error.code === 'UNSAFE_PATH'
            ? 'UNSAFE_PATH'
            : 'INVALID_CONFIG',
        message: error instanceof Error ? error.message : String(error),
        targetId: target.id,
        path: target.path,
      });
      continue;
    }

    if (
      resolvedTargetPaths.some((other) =>
        isSamePath(other, resolvedTargetPath),
      )
    ) {
      issues.push({
        code: 'INVALID_CONFIG',
        message: `Duplicate target path: ${resolvedTargetPath}`,
        targetId: target.id,
        path: resolvedTargetPath,
      });
    }

    for (const other of resolvedTargetPaths) {
      if (
        isPathInside(resolvedTargetPath, other) ||
        isPathInside(other, resolvedTargetPath)
      ) {
        issues.push({
          code: 'INVALID_CONFIG',
          message: `Target paths are nested or overlapping: ${resolvedTargetPath}`,
          targetId: target.id,
          path: resolvedTargetPath,
        });
      }
    }

    resolvedTargetPaths.push(resolvedTargetPath);
  }

  return issues;
}
