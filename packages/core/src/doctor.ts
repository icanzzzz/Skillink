import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  getSkillDir,
  getSkillinkPaths,
  type PackageFile,
  type RouteFile,
  type SkillFile,
  type SkillinkPaths,
} from '@skillink/shared';
import { readRouteFile } from './route.js';
import { readPackageFile } from './package-store.js';
import { readSkillFile } from './skill-store.js';
import { verifySkillIntegrity } from './skill-integrity.js';
import {
  computePackageIntegrity,
  resolvePackageGraph,
  validateAllPackages,
} from './package-graph.js';
import {
  assertSafeTargetPath,
  isPathInside,
  isSamePath,
} from './path-policy.js';
import { findCaseInsensitiveDuplicates } from './package-name.js';
import { status } from './status.js';

export type DoctorIssueCode =
  | 'MISSING_CONTENT'
  | 'ORPHAN_CONTENT'
  | 'ROUTE_MISSING_VERSION'
  | 'PACKAGE_INTEGRITY_MISMATCH'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_MD_MISSING'
  | 'SKILL_INTEGRITY_MISMATCH'
  | 'SKILL_VERSION_CONFLICT'
  | 'UNSUPPORTED_MODE'
  | 'PACKAGE_CYCLE'
  | 'PACKAGE_MISSING_VERSION'
  | 'UNUSED_PACKAGE_VERSION'
  | 'LINK_ISSUE'
  | 'UNSAFE_PATH'
  | 'INVALID_CONFIG';

export interface DoctorIssue {
  code: DoctorIssueCode;
  message: string;
  name?: string;
  version?: string;
  targetId?: string;
  path?: string;
  packageName?: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  ok: boolean;
  issues: DoctorIssue[];
}

export interface DoctorInput {
  paths?: SkillinkPaths;
  home?: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function pathIsDirectory(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then((info) => info.isDirectory())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

async function pathIsFile(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then((info) => info.isFile())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

function detailString(
  error: SkillinkError,
  key: string,
): string | undefined {
  const value = error.details?.[key];
  return typeof value === 'string' ? value : undefined;
}

function issueFromGraphError(
  error: unknown,
  targetId?: string,
): DoctorIssue {
  if (!(error instanceof SkillinkError)) {
    return {
      code: 'INVALID_CONFIG',
      message: error instanceof Error ? error.message : String(error),
      targetId,
    };
  }

  const name = detailString(error, 'skillName') ?? detailString(error, 'name');
  const version =
    detailString(error, 'version') ?? detailString(error, 'resolved');
  const packageName = detailString(error, 'packageName');

  switch (error.code) {
    case 'SKILL_VERSION_CONFLICT':
      return {
        code: 'SKILL_VERSION_CONFLICT',
        message: error.message,
        name,
        version,
        targetId,
        packageName,
      };
    case 'PACKAGE_CYCLE':
      return { code: 'PACKAGE_CYCLE', message: error.message, targetId };
    case 'VERSION_NOT_FOUND':
      if (detailString(error, 'skillName')) {
        return {
          code: 'SKILL_NOT_FOUND',
          message: error.message,
          name,
          version,
          targetId,
          packageName,
        };
      }
      return {
        code: 'PACKAGE_MISSING_VERSION',
        message: error.message,
        name,
        version,
        targetId,
        packageName,
      };
    case 'PACKAGE_NOT_FOUND':
      return {
        code: 'PACKAGE_MISSING_VERSION',
        message: error.message,
        name,
        version,
        targetId,
        packageName,
      };
    default:
      return {
        code: 'INVALID_CONFIG',
        message: error.message,
        name,
        version,
        targetId,
        packageName,
      };
  }
}

export async function doctor(input: DoctorInput = {}): Promise<DoctorReport> {
  const paths = input.paths ?? getSkillinkPaths(input.home);
  const issues: DoctorIssue[] = [];

  let route: RouteFile;
  let packageFile: PackageFile;
  let skillFile: SkillFile;
  try {
    route = await readRouteFile(paths);
    packageFile = await readPackageFile(paths);
    skillFile = await readSkillFile(paths);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: 'INVALID_CONFIG',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  for (const [first, second] of findCaseInsensitiveDuplicates(
    Object.keys(packageFile.packages),
  )) {
    issues.push({
      code: 'INVALID_CONFIG',
      message: `Package names collide case-insensitively: ${first} / ${second}`,
      name: second,
    });
  }

  for (const [first, second] of findCaseInsensitiveDuplicates(
    Object.keys(skillFile.skills),
  )) {
    issues.push({
      code: 'INVALID_CONFIG',
      message: `Skill names collide case-insensitively: ${first} / ${second}`,
      name: second,
    });
  }

  for (const [first, second] of findCaseInsensitiveDuplicates(
    route.targets.map((target) => target.id),
  )) {
    issues.push({
      code: 'INVALID_CONFIG',
      message: `Target ids collide case-insensitively: ${first} / ${second}`,
      targetId: second,
    });
  }

  const targetIds = new Set<string>();
  const resolvedTargetPaths: string[] = [];
  for (const target of route.targets) {
    if (target.mode !== 'link') {
      issues.push({
        code: 'UNSUPPORTED_MODE',
        message: `Target "${target.id}" uses unsupported mode "${target.mode}"; v2.0 only supports link mode.`,
        targetId: target.id,
        path: target.path,
      });
    }

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
      resolvedTargetPath = assertSafeTargetPath(target.path, paths);
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

    if (resolvedTargetPaths.some((other) => isSamePath(other, resolvedTargetPath))) {
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

  try {
    validateAllPackages(packageFile, skillFile);
  } catch (error) {
    issues.push(issueFromGraphError(error));
  }

  for (const [packageName, packageEntry] of Object.entries(
    packageFile.packages,
  )) {
    for (const [version, versionEntry] of Object.entries(
      packageEntry.versions,
    )) {
      for (const [skillName, skillVersion] of Object.entries(
        versionEntry.skills,
      )) {
        if (!skillFile.skills[skillName]?.versions[skillVersion]) {
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
        if (!packageFile.packages[nestedName]?.versions[nestedVersion]) {
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

  for (const [name, skillEntry] of Object.entries(skillFile.skills)) {
    for (const version of Object.keys(skillEntry.versions)) {
      const contentPath = getSkillDir(paths, name, version);

      if (!(await pathIsDirectory(contentPath))) {
        issues.push({
          code: 'MISSING_CONTENT',
          message: `Skill content is missing: ${name}@${version}`,
          name,
          version,
          path: contentPath,
        });
        continue;
      }

      if (!(await pathIsFile(path.join(contentPath, 'SKILL.md')))) {
        issues.push({
          code: 'SKILL_MD_MISSING',
          message: `Skill content has no SKILL.md: ${name}@${version}`,
          name,
          version,
          path: contentPath,
        });
        continue;
      }

      try {
        const integrity = await verifySkillIntegrity(
          paths,
          name,
          version,
          skillEntry.versions[version]!,
        );
        if (!integrity.ok) {
          issues.push({
            code: 'SKILL_INTEGRITY_MISMATCH',
            message: `Skill content does not match skill.json: ${name}@${version}`,
            name,
            version,
            path: contentPath,
            details: {
              expectedIntegrity: integrity.expected.integrity,
              actualIntegrity: integrity.actual.integrity,
              expectedFileCount: integrity.expected.fileCount,
              actualFileCount: integrity.actual.fileCount,
              expectedSize: integrity.expected.size,
              actualSize: integrity.actual.size,
            },
          });
        }
      } catch (error) {
        issues.push({
          code: 'INVALID_CONFIG',
          message: error instanceof Error ? error.message : String(error),
          name,
          version,
          path: contentPath,
        });
      }
    }
  }

  const skillDirectories = await readdir(paths.libraryDir, {
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });

  for (const skillDirectory of skillDirectories) {
    if (!skillDirectory.isDirectory()) {
      continue;
    }

    const skillEntry = skillFile.skills[skillDirectory.name];
    const versionDirectories = (
      await readdir(path.join(paths.libraryDir, skillDirectory.name), {
        withFileTypes: true,
      }).catch(() => [])
    ).filter((entry) => entry.isDirectory());

    if (!skillEntry) {
      if (versionDirectories.length === 0) {
        continue;
      }
      issues.push({
        code: 'ORPHAN_CONTENT',
        message: `Library directory is not in skill.json: ${skillDirectory.name}`,
        name: skillDirectory.name,
        path: path.join(paths.libraryDir, skillDirectory.name),
      });
      continue;
    }

    for (const versionDirectory of versionDirectories) {
      if (!skillEntry.versions[versionDirectory.name]) {
        issues.push({
          code: 'ORPHAN_CONTENT',
          message: `Library version is not in skill.json: ${skillDirectory.name}@${versionDirectory.name}`,
          name: skillDirectory.name,
          version: versionDirectory.name,
          path: path.join(
            paths.libraryDir,
            skillDirectory.name,
            versionDirectory.name,
          ),
        });
      }
    }
  }

  const referencedPackages = new Set<string>();

  for (const target of route.targets) {
    for (const [name, lock] of Object.entries(target.packages)) {
      referencedPackages.add(`${name}@${lock.resolved}`);

      const packageEntry = packageFile.packages[name];
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

      try {
        const expected = computePackageIntegrity(packageFile, [
          { name, version: lock.resolved },
        ]);
        if (expected !== lock.integrity) {
          issues.push({
            code: 'PACKAGE_INTEGRITY_MISMATCH',
            message: `Route lock does not match package.json: ${name}@${lock.resolved}`,
            name,
            version: lock.resolved,
            targetId: target.id,
          });
        }
      } catch (error) {
        issues.push(issueFromGraphError(error, target.id));
      }
    }

    try {
      const allRoots = Object.entries(target.packages).map(([name, lock]) => ({
        name,
        version: lock.resolved,
      }));
      if (allRoots.length > 0) {
        const allResolution = resolvePackageGraph(
          packageFile,
          skillFile,
          allRoots,
        );
        for (const id of allResolution.packages.keys()) {
          referencedPackages.add(id);
        }
      }
    } catch {
      // Broken or conflicting disabled locks are reported by the route checks
      // above; they must not hide package usage accounting for valid roots.
    }

    try {
      const resolution = resolvePackageGraph(
        packageFile,
        skillFile,
        Object.entries(target.packages)
          .filter(([, lock]) => lock.enabled !== false)
          .map(([name, lock]) => ({
            name,
            version: lock.resolved,
          })),
      );
      for (const id of resolution.packages.keys()) {
        referencedPackages.add(id);
      }
    } catch (error) {
      issues.push(issueFromGraphError(error, target.id));
    }
  }

  for (const [name, packageEntry] of Object.entries(packageFile.packages)) {
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

  const currentStatus = await status({ paths });
  for (const entry of currentStatus.entries) {
    if (entry.state === 'ok' || entry.state === 'disabled') {
      continue;
    }
    if (entry.name.startsWith('<')) {
      continue;
    }

    issues.push({
      code: 'LINK_ISSUE',
      message: `${entry.targetId}/${entry.name}: ${entry.state}`,
      name: entry.name,
      version: entry.version || undefined,
      targetId: entry.targetId,
      path: entry.path,
      packageName: entry.packageName,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
