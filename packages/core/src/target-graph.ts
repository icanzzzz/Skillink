import {
  SkillinkError,
  type PackageFile,
  type PackageLock,
  type SkillFile,
  type TargetRoute,
} from '@skillink/shared';
import {
  computePackageIntegrity,
  resolvePackageGraph,
  type PackageResolution,
} from './package-graph.js';

export interface TargetLockCheck {
  name: string;
  lock: PackageLock;
  error?: SkillinkError;
}

function packageLocks(
  target: TargetRoute,
  includeDisabled: boolean,
): Array<[string, PackageLock]> {
  return Object.entries(target.packages).filter(
    ([, lock]) => includeDisabled || lock.enabled !== false,
  );
}

export function checkTargetPackageLocks(
  packageFile: PackageFile,
  target: TargetRoute,
  options: { includeDisabled?: boolean } = {},
): TargetLockCheck[] {
  const checks: TargetLockCheck[] = [];

  for (const [name, lock] of packageLocks(
    target,
    options.includeDisabled ?? false,
  )) {
    const check: TargetLockCheck = { name, lock };
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
      if (!(error instanceof SkillinkError)) {
        throw error;
      }
      check.error = error;
    }
    checks.push(check);
  }

  return checks;
}

export function assertTargetPackageLocks(
  packageFile: PackageFile,
  target: TargetRoute,
): void {
  for (const check of checkTargetPackageLocks(packageFile, target)) {
    if (check.error) {
      throw check.error;
    }
  }
}

export function resolveTargetGraph(
  packageFile: PackageFile,
  skillFile: SkillFile,
  target: TargetRoute,
  options: { includeDisabledPackages?: boolean } = {},
): PackageResolution {
  const roots = packageLocks(
    target,
    options.includeDisabledPackages ?? false,
  ).map(([name, lock]) => ({ name, version: lock.resolved }));

  return resolvePackageGraph(packageFile, skillFile, roots);
}

export function resolveTarget(
  packageFile: PackageFile,
  skillFile: SkillFile,
  target: TargetRoute,
  options: { includeDisabledPackages?: boolean } = {},
): PackageResolution {
  assertTargetPackageLocks(packageFile, target);
  return resolveTargetGraph(packageFile, skillFile, target, options);
}
