import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  RouteFileSchema,
  createEmptyRouteFile,
  getPackageDir,
  type SkillinkPaths,
} from '@skillink/shared';
import { createTrashDirectory, readSkillsFile, writeSkillsFile } from './library.js';
import { withHistory } from './history.js';
import { readJsonFile } from './json-store.js';

export interface GcOptions {
  dryRun?: boolean;
  maxAgeDays?: number;
  keepTagged?: boolean;
}

export interface GcCandidate {
  name: string;
  version: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface GcPlan {
  dryRun: boolean;
  candidates: GcCandidate[];
  freedBytes: number;
}

export interface GcReport extends GcPlan {
  removed: GcCandidate[];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
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
  const library = await readSkillsFile(paths);
  const route = await readJsonFile(
    paths.routeFile,
    RouteFileSchema,
    createEmptyRouteFile(),
  );

  const referenced = new Set(
    route.targets.flatMap((target) =>
      Object.entries(target.skills).map(
        ([name, lock]) => `${name}@${lock.resolved}`,
      ),
    ),
  );

  const keepTagged = options.keepTagged ?? true;
  const maxAgeDays = options.maxAgeDays ?? 7;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const candidates: GcCandidate[] = [];

  for (const [name, packageEntry] of Object.entries(library.packages)) {
    const tagged = new Set(
      keepTagged ? Object.values(packageEntry.tags ?? {}) : [],
    );

    for (const [version, versionEntry] of Object.entries(packageEntry.versions)) {
      if (referenced.has(`${name}@${version}`) || tagged.has(version)) {
        continue;
      }

      const packageDir = getPackageDir(paths, name, version);
      const info = await directoryStat(packageDir);
      if (!info || info.mtimeMs > cutoff) {
        continue;
      }

      candidates.push({
        name,
        version,
        path: packageDir,
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
    const library = await readSkillsFile(paths);
    const trashDirectory = await createTrashDirectory(paths);
    const moved: Array<{ source: string; destination: string }> = [];

    try {
      for (const candidate of candidates) {
        const packageEntry = library.packages[candidate.name];
        if (!packageEntry?.versions[candidate.version]) {
          continue;
        }

        const destination = path.join(trashDirectory, candidate.name, candidate.version);
        await mkdir(path.dirname(destination), { recursive: true });
        try {
          await rename(candidate.path, destination);
          moved.push({ source: candidate.path, destination });
        } catch (error) {
          if (!(isNodeError(error) && error.code === 'ENOENT')) {
            throw error;
          }
        }

        const remainingVersions = { ...packageEntry.versions };
        delete remainingVersions[candidate.version];

        if (Object.keys(remainingVersions).length === 0) {
          delete library.packages[candidate.name];
        } else {
          const tags = Object.fromEntries(
            Object.entries(packageEntry.tags ?? {}).filter(
              ([, taggedVersion]) => taggedVersion !== candidate.version,
            ),
          );
          library.packages[candidate.name] = {
            ...packageEntry,
            versions: remainingVersions,
            tags,
          };
        }

        removed.push(candidate);
      }

      await writeSkillsFile(paths, library);
    } catch (error) {
      for (const item of moved.reverse()) {
        await mkdir(path.dirname(item.source), { recursive: true });
        await rename(item.destination, item.source).catch(() => undefined);
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
