import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import { readRouteFile } from './route.js';
import { readSkillsFile } from './library.js';
import { status } from './status.js';

export type DoctorIssueCode =
  | 'MISSING_CONTENT'
  | 'ORPHAN_CONTENT'
  | 'ROUTE_MISSING_VERSION'
  | 'ROUTE_INTEGRITY_MISMATCH'
  | 'LINK_ISSUE'
  | 'INVALID_CONFIG';

export interface DoctorIssue {
  code: DoctorIssueCode;
  message: string;
  name?: string;
  version?: string;
  targetId?: string;
  path?: string;
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

export async function doctor(input: DoctorInput = {}): Promise<DoctorReport> {
  const paths = input.paths ?? getSkillinkPaths(input.home);
  const issues: DoctorIssue[] = [];

  let route;
  let library;
  try {
    route = await readRouteFile(paths);
    library = await readSkillsFile(paths);
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

  for (const [name, packageEntry] of Object.entries(library.packages)) {
    for (const [version, versionEntry] of Object.entries(packageEntry.versions)) {
      const sourcePath = path.resolve(paths.home, versionEntry.source);

      if (!(await pathIsDirectory(sourcePath))) {
        issues.push({
          code: 'MISSING_CONTENT',
          message: `Library content is missing: ${name}@${version}`,
          name,
          version,
          path: sourcePath,
        });
      }
    }
  }

  const packageDirectories = await readdir(paths.libraryDir, {
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });

  for (const packageDirectory of packageDirectories) {
    if (!packageDirectory.isDirectory()) {
      continue;
    }

    const packageEntry = library.packages[packageDirectory.name];
    if (!packageEntry) {
      issues.push({
        code: 'ORPHAN_CONTENT',
        message: `Library directory is not in skills.json: ${packageDirectory.name}`,
        name: packageDirectory.name,
        path: path.join(paths.libraryDir, packageDirectory.name),
      });
      continue;
    }

    const versionDirectories = await readdir(
      path.join(paths.libraryDir, packageDirectory.name),
      { withFileTypes: true },
    ).catch(() => []);

    for (const versionDirectory of versionDirectories) {
      if (!versionDirectory.isDirectory()) {
        continue;
      }

      if (!packageEntry.versions[versionDirectory.name]) {
        issues.push({
          code: 'ORPHAN_CONTENT',
          message: `Library version is not in skills.json: ${packageDirectory.name}@${versionDirectory.name}`,
          name: packageDirectory.name,
          version: versionDirectory.name,
          path: path.join(
            paths.libraryDir,
            packageDirectory.name,
            versionDirectory.name,
          ),
        });
      }
    }
  }

  for (const target of route.targets) {
    for (const [name, lock] of Object.entries(target.skills)) {
      const packageEntry = library.packages[name];
      const versionEntry = packageEntry?.versions[lock.resolved];

      if (!packageEntry || !versionEntry) {
        issues.push({
          code: 'ROUTE_MISSING_VERSION',
          message: `Route references a version missing from skills.json: ${name}@${lock.resolved}`,
          name,
          version: lock.resolved,
          targetId: target.id,
        });
        continue;
      }

      if (
        versionEntry.integrity !== lock.integrity ||
        versionEntry.source !== lock.source
      ) {
        issues.push({
          code: 'ROUTE_INTEGRITY_MISMATCH',
          message: `Route lock does not match skills.json: ${name}@${lock.resolved}`,
          name,
          version: lock.resolved,
          targetId: target.id,
        });
      }
    }
  }

  const currentStatus = await status({ paths });
  for (const entry of currentStatus.entries) {
    if (entry.state === 'ok' || entry.state === 'disabled') {
      continue;
    }

    issues.push({
      code: 'LINK_ISSUE',
      message: `${entry.targetId}/${entry.name}: ${entry.state}`,
      name: entry.name,
      version: entry.version || undefined,
      targetId: entry.targetId,
      path: entry.path,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
