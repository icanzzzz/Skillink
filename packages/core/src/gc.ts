import { rm, stat } from 'node:fs/promises';
import {
  SkillinkError,
  getSkillDir,
  type GcCandidate,
  type GcPlan,
  type GcReport,
  type SkillinkPaths,
} from '@skillink/shared';
import {
  readSkillFile,
  removeEmptySkillParent,
  writeSkillFile,
} from './skill-store.js';
import { readPackageFile } from './package-store.js';
import { readRouteFile } from './route.js';
import { resolveTargetGraph } from './target-graph.js';
import { isPathInside } from './path-policy.js';
import { withFsRetry } from './fs-retry.js';
import { isNodeError } from './node-error.js';

export interface GcOptions {
  dryRun?: boolean;
  maxAgeDays?: number;
  keepTagged?: boolean;
}

async function directoryStat(
  directory: string,
): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    const info = await stat(directory);
    return info.isDirectory() ? info : undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function collectCandidates(
  paths: SkillinkPaths,
  options: GcOptions,
): Promise<GcCandidate[]> {
  const skillFile = await readSkillFile(paths);
  const route = await readRouteFile(paths);
  const packageFile = await readPackageFile(paths);

  const referenced = new Set<string>();

  for (const target of route.targets) {
    const resolution = resolveTargetGraph(packageFile, skillFile, target, {
      includeDisabledPackages: true,
    });
    for (const skill of resolution.skills.values()) {
      referenced.add(`${skill.name}@${skill.version}`);
    }
  }

  const keepTagged = options.keepTagged ?? true;
  if (keepTagged) {
    for (const [name, skillEntry] of Object.entries(skillFile.skills)) {
      for (const taggedVersion of Object.values(skillEntry.tags ?? {})) {
        referenced.add(`${name}@${taggedVersion}`);
      }
    }
  }

  const maxAgeDays = options.maxAgeDays ?? 7;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const candidates: GcCandidate[] = [];

  for (const [name, skillEntry] of Object.entries(skillFile.skills)) {
    for (const [version, versionEntry] of Object.entries(skillEntry.versions)) {
      if (referenced.has(`${name}@${version}`)) {
        continue;
      }

      const skillDir = getSkillDir(paths, name, version);
      const info = await directoryStat(skillDir);
      if (!info || info.mtimeMs > cutoff) {
        continue;
      }

      candidates.push({
        name,
        version,
        path: skillDir,
        size: versionEntry.size,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  }

  return candidates.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName !== 0 ? byName : left.version.localeCompare(right.version);
  });
}

function totalSize(candidates: GcCandidate[]): number {
  return candidates.reduce((total, candidate) => total + candidate.size, 0);
}

export async function planGc(
  paths: SkillinkPaths,
  options: GcOptions = {},
): Promise<GcPlan> {
  const candidates = await collectCandidates(paths, options);

  return {
    dryRun: options.dryRun ?? true,
    candidates,
    freedBytes: totalSize(candidates),
  };
}

export async function gc(
  paths: SkillinkPaths,
  options: GcOptions = {},
): Promise<GcReport> {
  const dryRun = options.dryRun ?? true;
  const candidates = await collectCandidates(paths, options);

  if (dryRun) {
    return {
      dryRun: true,
      candidates,
      removed: [],
      freedBytes: totalSize(candidates),
    };
  }

  const skillFile = await readSkillFile(paths);
  const removed: GcCandidate[] = [];
  const failed: Array<{
    name: string;
    version: string;
    path: string;
    message: string;
  }> = [];

  for (const candidate of candidates) {
    const skillEntry = skillFile.skills[candidate.name];
    if (!skillEntry?.versions[candidate.version]) {
      continue;
    }

    if (!isPathInside(candidate.path, paths.libraryDir)) {
      throw new SkillinkError(
        'UNSAFE_PATH',
        `GC candidate escapes the skill library: ${candidate.path}`,
        { name: candidate.name, version: candidate.version },
      );
    }

    try {
      await withFsRetry(() =>
        rm(candidate.path, { recursive: true, force: true }),
      );
      removed.push(candidate);
    } catch (error) {
      failed.push({
        name: candidate.name,
        version: candidate.version,
        path: candidate.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (removed.length > 0) {
    const nextSkills = { ...skillFile.skills };
    const removedSkillNames = new Set<string>();

    for (const candidate of removed) {
      const skillEntry = nextSkills[candidate.name];
      if (!skillEntry?.versions[candidate.version]) {
        continue;
      }

      const remainingVersions = { ...skillEntry.versions };
      delete remainingVersions[candidate.version];

      if (Object.keys(remainingVersions).length === 0) {
        delete nextSkills[candidate.name];
        removedSkillNames.add(candidate.name);
      } else {
        const tags = Object.fromEntries(
          Object.entries(skillEntry.tags ?? {}).filter(
            ([, taggedVersion]) => taggedVersion !== candidate.version,
          ),
        );
        nextSkills[candidate.name] = {
          ...skillEntry,
          versions: remainingVersions,
          ...(Object.keys(tags).length > 0 ? { tags } : { tags: undefined }),
        };
      }
    }

    await writeSkillFile(paths, {
      ...skillFile,
      skills: nextSkills,
    });

    for (const name of removedSkillNames) {
      await removeEmptySkillParent(paths, name);
    }
  }

  if (failed.length > 0) {
    throw new SkillinkError(
      'IO_ERROR',
      `Failed to delete ${failed.length} skill version(s).`,
      { failed },
    );
  }

  return {
    dryRun: false,
    candidates,
    removed,
    freedBytes: totalSize(removed),
  };
}
