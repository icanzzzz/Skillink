import {
  getSkillinkPaths,
  type DoctorReport,
  type PackageFile,
  type RouteFile,
  type SkillFile,
  type StatusReport,
  type SkillinkPaths,
} from '@skillink/shared';
import {
  readPackageConfig,
  readRouteConfig,
  readSkillConfig,
} from '../config-store.js';
import { status } from '../status.js';
import { checkTargetConfiguration } from './config.js';
import type { DoctorContext } from './issues.js';
import { checkTargetLinks } from './links.js';
import { checkPackageGraph, checkPackageUsage } from './packages.js';
import { checkSkillContent } from './skills.js';

export interface DoctorInput {
  paths?: SkillinkPaths;
  home?: string;
  statusReport?: StatusReport;
}

export async function doctor(
  input: DoctorInput = {},
): Promise<DoctorReport> {
  const paths = input.paths ?? getSkillinkPaths(input.home);

  let route: RouteFile;
  let packageFile: PackageFile;
  let skillFile: SkillFile;
  try {
    [route, packageFile, skillFile] = await Promise.all([
      readRouteConfig(paths),
      readPackageConfig(paths),
      readSkillConfig(paths),
    ]);
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

  const ctx: DoctorContext = { paths, route, packageFile, skillFile };
  const currentStatus = input.statusReport ?? (await status({ paths }));
  const issues = [
    ...(await checkTargetConfiguration(ctx)),
    ...checkPackageGraph(ctx),
    ...checkPackageUsage(ctx),
    ...(await checkSkillContent(ctx)),
    ...checkTargetLinks(currentStatus),
  ];

  return {
    ok: issues.length === 0,
    issues,
  };
}
