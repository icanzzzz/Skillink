import { stat } from 'node:fs/promises';
import {
  SkillinkError,
  type DoctorIssue,
  type PackageFile,
  type RouteFile,
  type SkillFile,
  type SkillinkPaths,
} from '@skillink/shared';
import { isNodeError } from '../node-error.js';

export interface DoctorContext {
  paths: SkillinkPaths;
  route: RouteFile;
  packageFile: PackageFile;
  skillFile: SkillFile;
}

export async function pathIsDirectory(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then((info) => info.isDirectory())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

export async function pathIsFile(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then((info) => info.isFile())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

export function detailString(
  error: SkillinkError,
  key: string,
): string | undefined {
  const value = error.details?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function issueFromGraphError(
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
