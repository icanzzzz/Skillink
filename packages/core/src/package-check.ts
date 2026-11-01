import {
  SkillinkError,
  type SkillinkPaths,
} from '@skillink/shared';
import { readPackageFile } from './package-store.js';
import { assertSkillContent, readSkillFile } from './skill-store.js';
import { readRouteFile } from './route.js';
import { collectPackageNodes } from './package-graph.js';
import { gcTargetEntries } from './target-gc.js';

export interface BrokenPackageSkillReference {
  packageName: string;
  packageVersion: string;
  skillName: string;
  skillVersion: string;
}

export interface PackageCheckTargetResult {
  targetId: string;
  skillNames: string[];
  removed: string[];
}

export interface PackageCheckFailure {
  targetId: string;
  message: string;
}

export interface PackageCheckReport {
  brokenReferences: BrokenPackageSkillReference[];
  targets: PackageCheckTargetResult[];
  failures: PackageCheckFailure[];
}

type SkillUsability = Map<string, Promise<boolean>>;

function skillKey(name: string, version: string): string {
  return `${name}@${version}`;
}

async function isSkillUsable(
  paths: SkillinkPaths,
  skillFile: Awaited<ReturnType<typeof readSkillFile>>,
  name: string,
  version: string,
  cache: SkillUsability,
): Promise<boolean> {
  const key = skillKey(name, version);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }

  const pending = (async (): Promise<boolean> => {
    if (!skillFile.skills[name]?.versions[version]) {
      return false;
    }

    try {
      await assertSkillContent(paths, name, version);
      return true;
    } catch (error) {
      if (
        error instanceof SkillinkError &&
        (error.code === 'VERSION_NOT_FOUND' ||
          error.code === 'SKILL_MD_MISSING')
      ) {
        return false;
      }
      throw error;
    }
  })();

  cache.set(key, pending);
  return pending;
}

/**
 * Find package versions whose skill references no longer resolve, then remove
 * those skills from targets that reference the affected packages.
 *
 * This is a package-domain consistency check. Target projection deletion is
 * delegated to the target module (`gcTargetEntries`).
 */
export async function checkPackageSkillReferences(
  paths: SkillinkPaths,
): Promise<PackageCheckReport> {
  const [packageFile, skillFile, route] = await Promise.all([
    readPackageFile(paths),
    readSkillFile(paths),
    readRouteFile(paths),
  ]);
  const usability: SkillUsability = new Map();
  const brokenReferences: BrokenPackageSkillReference[] = [];
  const brokenByPackage = new Map<string, Set<string>>();

  for (const [packageName, packageEntry] of Object.entries(
    packageFile.packages,
  )) {
    for (const [packageVersion, versionEntry] of Object.entries(
      packageEntry.versions,
    )) {
      for (const [skillName, skillVersion] of Object.entries(
        versionEntry.skills,
      )) {
        if (
          await isSkillUsable(
            paths,
            skillFile,
            skillName,
            skillVersion,
            usability,
          )
        ) {
          continue;
        }

        brokenReferences.push({
          packageName,
          packageVersion,
          skillName,
          skillVersion,
        });

        const packageId = `${packageName}@${packageVersion}`;
        const names = brokenByPackage.get(packageId) ?? new Set<string>();
        names.add(skillName);
        brokenByPackage.set(packageId, names);
      }
    }
  }

  if (brokenReferences.length === 0) {
    return {
      brokenReferences,
      targets: [],
      failures: [],
    };
  }

  const targets: PackageCheckTargetResult[] = [];
  const failures: PackageCheckFailure[] = [];

  for (const target of route.targets) {
    const roots = Object.entries(target.packages).map(([name, lock]) => ({
      name,
      version: lock.resolved,
    }));

    if (roots.length === 0) {
      continue;
    }

    let nodes;
    try {
      nodes = collectPackageNodes(packageFile, roots);
    } catch (error) {
      failures.push({
        targetId: target.id,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const referencedBrokenNames = new Set<string>();
    for (const packageId of nodes.keys()) {
      for (const name of brokenByPackage.get(packageId) ?? []) {
        referencedBrokenNames.add(name);
      }
    }

    if (referencedBrokenNames.size === 0) {
      continue;
    }

    const validSkillNames = new Set<string>();
    for (const node of nodes.values()) {
      for (const [skillName, skillVersion] of Object.entries(
        node.entry.skills,
      )) {
        if (
          await isSkillUsable(
            paths,
            skillFile,
            skillName,
            skillVersion,
            usability,
          )
        ) {
          validSkillNames.add(skillName);
        }
      }
    }

    const skillNames = [...referencedBrokenNames]
      .filter((name) => !validSkillNames.has(name))
      .sort();

    if (skillNames.length === 0) {
      continue;
    }

    try {
      const removed = await gcTargetEntries({
        paths,
        target,
        skillNames,
      });
      targets.push({
        targetId: target.id,
        skillNames,
        removed,
      });
    } catch (error) {
      failures.push({
        targetId: target.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    brokenReferences,
    targets,
    failures,
  };
}
