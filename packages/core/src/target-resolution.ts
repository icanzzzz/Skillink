import {
  SkillinkError,
  getSkillinkPaths,
  type SkillinkPaths,
} from '@skillink/shared';
import { resolvePackageGraph } from './package-graph.js';
import { readPackageFile } from './package-store.js';
import { readRouteFile } from './route.js';
import { readSkillFile } from './skill-store.js';

export interface TargetSkillSummary {
  targetId: string;
  skills: Array<{ name: string; version: string }>;
  error?: string;
}

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
    const roots = Object.entries(target.packages)
      .filter(([, lock]) => lock.enabled !== false)
      .map(([name, lock]) => ({ name, version: lock.resolved }));

    try {
      const resolution = resolvePackageGraph(packageFile, skillFile, roots);
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
