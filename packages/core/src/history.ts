import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  PackageFileSchema,
  RouteFileSchema,
  SkillFileSchema,
  SkillinkError,
  createEmptyPackageFile,
  createEmptyRouteFile,
  createEmptySkillFile,
  getSkillDir,
  type HistoryEntry,
  type PackageFile,
  type RouteFile,
  type SkillFile,
  type SkillVersion,
  type SkillinkPaths,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';
import { withFsRetry } from './fs-retry.js';
import { scanFolder } from './folder-scan.js';
import {
  computePackageIntegrity,
  resolvePackageGraph,
  validateAllPackages,
} from './package-graph.js';
import { isNodeError } from './node-error.js';

export interface ConfigSet {
  route: RouteFile;
  packages: PackageFile;
  skills: SkillFile;
}

export interface WriteConfigSetOptions {
  write?: (
    filePath: string,
    value: unknown,
    schema: { parse: (input: unknown) => unknown },
  ) => Promise<void>;
}

export async function writeConfigSet(
  paths: SkillinkPaths,
  set: ConfigSet,
  options: WriteConfigSetOptions = {},
): Promise<void> {
  const write = options.write ?? writeJsonAtomic;
  const [previousRoute, previousPackages, previousSkills] = await Promise.all([
    readJsonFile(paths.routeFile, RouteFileSchema, createEmptyRouteFile()),
    readJsonFile(
      paths.packageFile,
      PackageFileSchema,
      createEmptyPackageFile(),
    ),
    readJsonFile(paths.skillFile, SkillFileSchema, createEmptySkillFile()),
  ]);

  try {
    await write(paths.skillFile, set.skills, SkillFileSchema);
    await write(paths.packageFile, set.packages, PackageFileSchema);
    await write(paths.routeFile, set.route, RouteFileSchema);
  } catch (error) {
    const restoreFailures: unknown[] = [];
    const restores: Array<() => Promise<void>> = [
      () => write(paths.skillFile, previousSkills, SkillFileSchema),
      () => write(paths.packageFile, previousPackages, PackageFileSchema),
      () => write(paths.routeFile, previousRoute, RouteFileSchema),
    ];

    for (const restore of restores) {
      try {
        await restore();
      } catch (restoreError) {
        restoreFailures.push(restoreError);
      }
    }

    if (restoreFailures.length > 0) {
      throw new SkillinkError(
        'IO_ERROR',
        `Failed to write configuration and failed to restore the previous files: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          restoreFailures: restoreFailures.map((failure) =>
            failure instanceof Error ? failure.message : String(failure),
          ),
        },
        { cause: error },
      );
    }

    throw error;
  }
}

const HistoryMetaSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  reason: z.string(),
  format: z.literal(2),
});

const MAX_SNAPSHOTS = 50;
const SAFE_SNAPSHOT_ID = /^[A-Za-z0-9._-]+$/;

function snapshotId(date: Date): string {
  return date.toISOString().replaceAll(':', '-');
}

async function directoryExists(directory: string): Promise<boolean> {
  return stat(directory)
    .then(() => true)
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

function assertSnapshotId(id: string): void {
  if (!SAFE_SNAPSHOT_ID.test(id) || id === '.' || id === '..') {
    throw new SkillinkError(
      'HISTORY_NOT_FOUND',
      `History snapshot "${id}" was not found.`,
      { id },
    );
  }
}

async function readHistoryEntry(
  directory: string,
): Promise<HistoryEntry | undefined> {
  try {
    const meta = HistoryMetaSchema.parse(
      JSON.parse(await readFile(path.join(directory, 'meta.json'), 'utf8')),
    );

    return {
      id: meta.id,
      path: directory,
      createdAt: meta.createdAt,
      reason: meta.reason,
    };
  } catch {
    return undefined;
  }
}

async function pruneHistory(paths: SkillinkPaths): Promise<void> {
  const entries = await listHistory(paths);

  for (const entry of entries.slice(MAX_SNAPSHOTS)) {
    await withFsRetry(() => rm(entry.path, { recursive: true, force: true }));
  }
}

export async function createHistorySnapshot(
  paths: SkillinkPaths,
  reason: string,
): Promise<HistoryEntry> {
  const route = await readJsonFile(
    paths.routeFile,
    RouteFileSchema,
    createEmptyRouteFile(),
  );
  const packages = await readJsonFile(
    paths.packageFile,
    PackageFileSchema,
    createEmptyPackageFile(),
  );
  const skills = await readJsonFile(
    paths.skillFile,
    SkillFileSchema,
    createEmptySkillFile(),
  );

  await mkdir(paths.historyDir, { recursive: true });

  let timestamp = Date.now();
  let id = snapshotId(new Date(timestamp));
  while (await directoryExists(path.join(paths.historyDir, id))) {
    timestamp += 1;
    id = snapshotId(new Date(timestamp));
  }

  const snapshotPath = path.join(paths.historyDir, id);
  const createdAt = new Date(timestamp).toISOString();

  await mkdir(snapshotPath, { recursive: true });

  try {
    await writeJsonAtomic(
      path.join(snapshotPath, 'route.json'),
      route,
      RouteFileSchema,
    );
    await writeJsonAtomic(
      path.join(snapshotPath, 'package.json'),
      packages,
      PackageFileSchema,
    );
    await writeJsonAtomic(
      path.join(snapshotPath, 'skill.json'),
      skills,
      SkillFileSchema,
    );
    await writeJsonAtomic(
      path.join(snapshotPath, 'meta.json'),
      { id, createdAt, reason, format: 2 },
      HistoryMetaSchema,
    );
  } catch (error) {
    await withFsRetry(() =>
      rm(snapshotPath, { recursive: true, force: true }),
    ).catch(() => undefined);
    throw error;
  }

  await pruneHistory(paths);

  return { id, path: snapshotPath, createdAt, reason };
}

export async function listHistory(
  paths: SkillinkPaths,
): Promise<HistoryEntry[]> {
  const directories = await readdir(paths.historyDir, {
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });

  const entries: HistoryEntry[] = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) {
      continue;
    }

    const entry = await readHistoryEntry(
      path.join(paths.historyDir, directory.name),
    );
    if (entry) {
      entries.push(entry);
    }
  }

  return entries.sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return right.createdAt.localeCompare(left.createdAt);
    }

    return right.id.localeCompare(left.id);
  });
}

interface ContentRestore {
  source: string;
  destination: string;
}

interface MissingContent {
  name: string;
  version: string;
}

async function directoryIsDirectory(directory: string): Promise<boolean> {
  return stat(directory)
    .then((info) => info.isDirectory())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

async function isFile(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then((info) => info.isFile())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

async function isSkillContent(directory: string): Promise<boolean> {
  return (
    (await directoryIsDirectory(directory)) &&
    (await isFile(path.join(directory, 'SKILL.md')))
  );
}

async function isValidSkillContent(
  directory: string,
  expected: SkillVersion,
): Promise<boolean> {
  if (!(await isSkillContent(directory))) {
    return false;
  }

  const scan = await scanFolder(directory).catch(() => undefined);
  return (
    scan?.kind === 'skill' &&
    scan.integrity === expected.integrity &&
    scan.fileCount === expected.fileCount &&
    scan.totalSize === expected.size
  );
}

async function findTrashCopy(
  paths: SkillinkPaths,
  name: string,
  version: string,
  expected: SkillVersion,
): Promise<string | undefined> {
  const directories = await readdir(paths.trashDir, {
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });

  const newestFirst = directories
    .filter((directory) => directory.isDirectory())
    .sort((left, right) => right.name.localeCompare(left.name));

  for (const directory of newestFirst) {
    const candidate = path.join(
      paths.trashDir,
      directory.name,
      name,
      version,
    );
    if (await isValidSkillContent(candidate, expected)) {
      return candidate;
    }
  }

  return undefined;
}

async function planContentRestores(
  paths: SkillinkPaths,
  skills: SkillFile,
): Promise<{ restores: ContentRestore[]; missing: MissingContent[] }> {
  const restores: ContentRestore[] = [];
  const missing: MissingContent[] = [];

  for (const [name, skillEntry] of Object.entries(skills.skills)) {
    for (const version of Object.keys(skillEntry.versions)) {
      const expected = skillEntry.versions[version]!;
      const destination = getSkillDir(paths, name, version);

      if (await isValidSkillContent(destination, expected)) {
        continue;
      }

      const source = await findTrashCopy(paths, name, version, expected);
      if (source) {
        restores.push({ source, destination });
      } else {
        missing.push({ name, version });
      }
    }
  }

  return { restores, missing };
}

function validateSnapshot(
  route: RouteFile,
  packages: PackageFile,
  skills: SkillFile,
): void {
  validateAllPackages(packages, skills);

  for (const target of route.targets) {
    for (const [name, lock] of Object.entries(target.packages)) {
      const expected = computePackageIntegrity(packages, [
        { name, version: lock.resolved },
      ]);
      if (expected !== lock.integrity) {
        throw new SkillinkError(
          'PACKAGE_INTEGRITY_MISMATCH',
          `History snapshot route lock does not match package.json: ${name}@${lock.resolved}`,
          { name, version: lock.resolved, targetId: target.id },
        );
      }
    }

    resolvePackageGraph(
      packages,
      skills,
      Object.entries(target.packages)
        .filter(([, lock]) => lock.enabled !== false)
        .map(([name, lock]) => ({
          name,
          version: lock.resolved,
        })),
    );
  }
}

export async function restoreHistorySnapshot(
  paths: SkillinkPaths,
  id: string,
): Promise<void> {
  assertSnapshotId(id);
  const snapshotPath = path.join(paths.historyDir, id);
  const entry = await readHistoryEntry(snapshotPath);

  if (!entry) {
    throw new SkillinkError(
      'HISTORY_NOT_FOUND',
      `History snapshot "${id}" was not found.`,
      { id },
    );
  }

  let route: RouteFile;
  let packages: PackageFile;
  let skills: SkillFile;
  try {
    route = RouteFileSchema.parse(
      JSON.parse(await readFile(path.join(snapshotPath, 'route.json'), 'utf8')),
    );
    packages = PackageFileSchema.parse(
      JSON.parse(
        await readFile(path.join(snapshotPath, 'package.json'), 'utf8'),
      ),
    );
    skills = SkillFileSchema.parse(
      JSON.parse(await readFile(path.join(snapshotPath, 'skill.json'), 'utf8')),
    );
  } catch (error) {
    throw new SkillinkError(
      'HISTORY_NOT_FOUND',
      `History snapshot "${id}" is incomplete or invalid.`,
      { id, snapshotPath },
      { cause: error },
    );
  }

  validateSnapshot(route, packages, skills);

  const { restores, missing } = await planContentRestores(paths, skills);
  if (missing.length > 0) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Cannot restore history snapshot "${id}": skill content is missing and was not found in trash.`,
      { id, missing },
    );
  }

  await createHistorySnapshot(paths, `restore:${id}`);

  for (const restore of restores) {
    await mkdir(path.dirname(restore.destination), { recursive: true });
    await withFsRetry(() =>
      rm(restore.destination, { recursive: true, force: true }),
    );
    try {
      await withFsRetry(() => rename(restore.source, restore.destination));
    } catch (error) {
      throw new SkillinkError(
        'IO_ERROR',
        `Failed to restore skill content: ${restore.destination}`,
        {
          snapshotId: id,
          source: restore.source,
          destination: restore.destination,
        },
        { cause: error },
      );
    }
  }

  await writeConfigSet(paths, { skills, packages, route });
}

export async function withHistory<T>(
  paths: SkillinkPaths,
  reason: string,
  action: () => Promise<T>,
): Promise<T> {
  await createHistorySnapshot(paths, reason);
  return action();
}
