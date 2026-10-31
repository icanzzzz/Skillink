import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  getSkillDir,
  type GcCandidate,
  type GcPlan,
  type GcReport,
  type SkillinkPaths,
} from '@skillink/shared';
import {
  createTrashDirectory,
  readSkillFile,
  removeEmptySkillParent,
  writeSkillFile,
} from './skill-store.js';
import { readPackageFile } from './package-store.js';
import { readRouteFile } from './route.js';
import { resolvePackageGraph } from './package-graph.js';
import { isPathInside } from './path-policy.js';
import { withHistory } from './history.js';
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
    const roots = Object.entries(target.packages).map(([name, lock]) => ({
      name,
      version: lock.resolved,
    }));

    if (roots.length === 0) {
      continue;
    }

    const resolution = resolvePackageGraph(packageFile, skillFile, roots);
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

  const removed: GcCandidate[] = [];

  await withHistory(paths, 'gc', async () => {
    const skillFile = await readSkillFile(paths);
    const trashDirectory = await createTrashDirectory(paths);
    const moved: Array<{ source: string; destination: string }> = [];
    const removedSkillNames = new Set<string>();

    try {
      for (const candidate of candidates) {
        const skillEntry = skillFile.skills[candidate.name];
        if (!skillEntry?.versions[candidate.version]) {
          continue;
        }

        if (
          !isPathInside(candidate.path, paths.libraryDir) &&
          candidate.path !== paths.libraryDir
        ) {
          throw new SkillinkError(
            'UNSAFE_PATH',
            `GC candidate escapes the skill library: ${candidate.path}`,
            { name: candidate.name, version: candidate.version },
          );
        }

        const destination = path.join(
          trashDirectory,
          candidate.name,
          candidate.version,
        );
        await mkdir(path.dirname(destination), { recursive: true });
        try {
          await withFsRetry(() => rename(candidate.path, destination));
          moved.push({ source: candidate.path, destination });
        } catch (error) {
          if (!(isNodeError(error) && error.code === 'ENOENT')) {
            throw error;
          }
        }

        const remainingVersions = { ...skillEntry.versions };
        delete remainingVersions[candidate.version];

        if (Object.keys(remainingVersions).length === 0) {
          delete skillFile.skills[candidate.name];
          removedSkillNames.add(candidate.name);
        } else {
          const tags = Object.fromEntries(
            Object.entries(skillEntry.tags ?? {}).filter(
              ([, taggedVersion]) => taggedVersion !== candidate.version,
            ),
          );
          skillFile.skills[candidate.name] = {
            ...skillEntry,
            versions: remainingVersions,
            ...(Object.keys(tags).length > 0 ? { tags } : { tags: undefined }),
          };
        }

        removed.push(candidate);
      }

      await writeSkillFile(paths, skillFile);
      for (const name of removedSkillNames) {
        await removeEmptySkillParent(paths, name);
      }
    } catch (error) {
      for (const item of moved.reverse()) {
        await mkdir(path.dirname(item.source), { recursive: true });
        await withFsRetry(() =>
          rename(item.destination, item.source),
        ).catch(() => undefined);
      }
      throw error;
    }
  });

  return {
    dryRun: false,
    candidates,
    removed,
    freedBytes: totalSize(removed),
  };
}
