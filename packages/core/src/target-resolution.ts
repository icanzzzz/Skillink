import {
  SkillinkError,
  getSkillinkPaths,
  type SkillinkPaths,
  type TargetSkillSummary,
} from '@skillink/shared';
import {
  checkTargetPackageLocks,
  resolveTargetGraph,
} from './target-graph.js';
import { readPackageFile } from './package-store.js';
import { readRouteFile } from './route.js';
import { readSkillFile } from './skill-store.js';

export interface SummarizeTargetSkillsInput {
  paths?: SkillinkPaths;
  home?: string;
}

export async function summarizeTargetSkills(
  input: SummarizeTargetSkillsInput = {},
): Promise<TargetSkillSummary[]> {
  const paths = input.paths ?? getSkillinkPaths(input.home);
  const [route, packageFile, skillFile] = await Promise.all([
    readRouteFile(paths),
    readPackageFile(paths),
    readSkillFile(paths),
  ]);

  return route.targets.map((target) => {
    try {
      const failed = checkTargetPackageLocks(packageFile, target).find(
        (check) => check.error !== undefined,
      );
      if (failed?.error) {
        throw failed.error;
      }

      const resolution = resolveTargetGraph(packageFile, skillFile, target);
      return {
        targetId: target.id,
        skills: [...resolution.skills.values()]
          .map((skill) => ({ name: skill.name, version: skill.version }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      };
    } catch (error) {
      return {
        targetId: target.id,
        skills: [],
        error:
          error instanceof SkillinkError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error),
      };
    }
  });
}
