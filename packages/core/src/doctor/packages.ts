import type { DoctorIssue } from '@skillink/shared';
import { validateAllPackages } from '../package-graph.js';
import {
  checkTargetPackageLocks,
  resolveTargetGraph,
} from '../target-graph.js';
import { issueFromGraphError, type DoctorContext } from './issues.js';

export function checkPackageGraph(ctx: DoctorContext): DoctorIssue[] {
  const issues: DoctorIssue[] = [];

  try {
    validateAllPackages(ctx.packageFile, ctx.skillFile);
  } catch (error) {
    issues.push(issueFromGraphError(error));
  }

  for (const [packageName, packageEntry] of Object.entries(
    ctx.packageFile.packages,
  )) {
    for (const [version, versionEntry] of Object.entries(
      packageEntry.versions,
    )) {
      for (const [skillName, skillVersion] of Object.entries(
        versionEntry.skills,
      )) {
        if (!ctx.skillFile.skills[skillName]?.versions[skillVersion]) {
          issues.push({
            code: 'SKILL_NOT_FOUND',
            message: `Package ${packageName}@${version} references missing skill ${skillName}@${skillVersion}.`,
            name: skillName,
            version: skillVersion,
            packageName,
          });
        }
      }

      for (const [nestedName, nestedVersion] of Object.entries(
        versionEntry.packages,
      )) {
        if (
          !ctx.packageFile.packages[nestedName]?.versions[nestedVersion]
        ) {
          issues.push({
            code: 'PACKAGE_MISSING_VERSION',
            message: `Package ${packageName}@${version} references missing package ${nestedName}@${nestedVersion}.`,
            name: nestedName,
            version: nestedVersion,
            packageName,
          });
        }
      }
    }
  }

  return issues;
}

export function checkPackageUsage(ctx: DoctorContext): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const referencedPackages = new Set<string>();

  for (const target of ctx.route.targets) {
    const lockErrors = new Map(
      checkTargetPackageLocks(ctx.packageFile, target, {
        includeDisabled: true,
      })
        .filter((check) => check.error !== undefined)
        .map((check) => [check.name, check.error!] as const),
    );

    for (const [name, lock] of Object.entries(target.packages)) {
      referencedPackages.add(`${name}@${lock.resolved}`);

      const packageEntry = ctx.packageFile.packages[name];
      const versionEntry = packageEntry?.versions[lock.resolved];

      if (!packageEntry || !versionEntry) {
        issues.push({
          code: 'ROUTE_MISSING_VERSION',
          message: `Route references a package version missing from package.json: ${name}@${lock.resolved}`,
          name,
          version: lock.resolved,
          targetId: target.id,
        });
        continue;
      }

      const error = lockErrors.get(name);
      if (!error) {
        continue;
      }

      if (error.code === 'PACKAGE_INTEGRITY_MISMATCH') {
        issues.push({
          code: 'PACKAGE_INTEGRITY_MISMATCH',
          message: `Route lock does not match package.json: ${name}@${lock.resolved}`,
          name,
          version: lock.resolved,
          targetId: target.id,
        });
      } else {
        issues.push(issueFromGraphError(error, target.id));
      }
    }

    try {
      const allResolution = resolveTargetGraph(
        ctx.packageFile,
        ctx.skillFile,
        target,
        { includeDisabledPackages: true },
      );
      for (const id of allResolution.packages.keys()) {
        referencedPackages.add(id);
      }
    } catch {
      // Broken or conflicting disabled locks are reported by the route checks
      // above; they must not hide package usage accounting for valid roots.
    }

    try {
      const resolution = resolveTargetGraph(
        ctx.packageFile,
        ctx.skillFile,
        target,
      );
      for (const id of resolution.packages.keys()) {
        referencedPackages.add(id);
      }
    } catch (error) {
      issues.push(issueFromGraphError(error, target.id));
    }
  }

  for (const [name, packageEntry] of Object.entries(ctx.packageFile.packages)) {
    for (const version of Object.keys(packageEntry.versions)) {
      if (!referencedPackages.has(`${name}@${version}`)) {
        issues.push({
          code: 'UNUSED_PACKAGE_VERSION',
          message: `Package version is not referenced by any route: ${name}@${version}`,
          name,
          version,
          packageName: name,
        });
      }
    }
  }

  return issues;
}
