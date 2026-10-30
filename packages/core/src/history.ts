import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  RouteFileSchema,
  SkillinkError,
  SkillsFileSchema,
  createEmptyRouteFile,
  createEmptySkillsFile,
  type SkillinkPaths,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';

export interface HistoryEntry {
  id: string;
  path: string;
  createdAt: string;
  reason: string;
}

const HistoryMetaSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  reason: z.string(),
});

const MAX_SNAPSHOTS = 50;
const SAFE_SNAPSHOT_ID = /^[A-Za-z0-9._-]+$/;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

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
    throw new SkillinkError('HISTORY_NOT_FOUND', `History snapshot "${id}" was not found.`, {
      id,
    });
  }
}

async function readHistoryEntry(directory: string): Promise<HistoryEntry | undefined> {
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
    await rm(entry.path, { recursive: true, force: true });
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
  const skills = await readJsonFile(
    paths.skillsFile,
    SkillsFileSchema,
    createEmptySkillsFile(),
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
    await writeJsonAtomic(path.join(snapshotPath, 'route.json'), route, RouteFileSchema);
    await writeJsonAtomic(path.join(snapshotPath, 'skills.json'), skills, SkillsFileSchema);
    await writeJsonAtomic(
      path.join(snapshotPath, 'meta.json'),
      { id, createdAt, reason },
      HistoryMetaSchema,
    );
  } catch (error) {
    await rm(snapshotPath, { recursive: true, force: true });
    throw error;
  }

  await pruneHistory(paths);

  return { id, path: snapshotPath, createdAt, reason };
}

export async function listHistory(paths: SkillinkPaths): Promise<HistoryEntry[]> {
  const directories = await readdir(paths.historyDir, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    },
  );

  const entries: HistoryEntry[] = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) {
      continue;
    }

    const entry = await readHistoryEntry(path.join(paths.historyDir, directory.name));
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

export async function restoreHistorySnapshot(
  paths: SkillinkPaths,
  id: string,
): Promise<void> {
  assertSnapshotId(id);
  const snapshotPath = path.join(paths.historyDir, id);
  const entry = await readHistoryEntry(snapshotPath);

  if (!entry) {
    throw new SkillinkError('HISTORY_NOT_FOUND', `History snapshot "${id}" was not found.`, {
      id,
    });
  }

  let route;
  let skills;
  try {
    route = RouteFileSchema.parse(
      JSON.parse(await readFile(path.join(snapshotPath, 'route.json'), 'utf8')),
    );
    skills = SkillsFileSchema.parse(
      JSON.parse(await readFile(path.join(snapshotPath, 'skills.json'), 'utf8')),
    );
  } catch (error) {
    throw new SkillinkError(
      'HISTORY_NOT_FOUND',
      `History snapshot "${id}" is incomplete or invalid.`,
      { id, snapshotPath },
      { cause: error },
    );
  }

  await createHistorySnapshot(paths, `restore:${id}`);

  // Write skills.json first so route.json never references a version that is
  // absent from the restored library.
  await writeJsonAtomic(paths.skillsFile, skills, SkillsFileSchema);
  await writeJsonAtomic(paths.routeFile, route, RouteFileSchema);
}

export async function withHistory<T>(
  paths: SkillinkPaths,
  reason: string,
  action: () => Promise<T>,
): Promise<T> {
  await createHistorySnapshot(paths, reason);
  return action();
}
