import {
  RouteFileSchema,
  SkillinkError,
  SkillsFileSchema,
  createEmptyRouteFile,
  createEmptySkillsFile,
  getPackageDir,
  type LibraryVersion,
  type PackageKind,
  type SkillinkPaths,
  type SkillsFile,
} from '@skillink/shared';
import { lstat, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile, writeJsonAtomic } from './json-store.js';
import { withHistory } from './history.js';

export async function readSkillsFile(paths: SkillinkPaths): Promise<SkillsFile> {
  return readJsonFile(paths.skillsFile, SkillsFileSchema, createEmptySkillsFile());
}

export async function writeSkillsFile(
  paths: SkillinkPaths,
  file: SkillsFile,
): Promise<void> {
  await writeJsonAtomic(paths.skillsFile, file, SkillsFileSchema);
}

export function librarySourcePath(name: string, version: string): string {
  return `skills/${name}/${version}`;
}

export interface UpsertLibraryVersionInput {
  name: string;
  version: string;
  integrity: string;
  fileCount: number;
  size: number;
  kind: PackageKind;
  built?: boolean;
}

export async function upsertLibraryVersion(
  paths: SkillinkPaths,
  input: UpsertLibraryVersionInput,
): Promise<{ created: boolean }> {
  const file = await readSkillsFile(paths);
  const packageEntry = file.packages[input.name] ?? {
    kind: input.kind,
    versions: {},
  };
  const existing = packageEntry.versions[input.version];

  if (existing) {
    if (existing.integrity === input.integrity) {
      return { created: false };
    }

    throw new SkillinkError(
      'PACKAGE_EXISTS',
      `Package ${input.name}@${input.version} already exists with different content.`,
      {
        name: input.name,
        version: input.version,
        existingIntegrity: existing.integrity,
        incomingIntegrity: input.integrity,
      },
    );
  }

  const version: LibraryVersion = {
    integrity: input.integrity,
    source: librarySourcePath(input.name, input.version),
    fileCount: input.fileCount,
    size: input.size,
    built: input.built ?? false,
  };

  file.packages[input.name] = {
    ...packageEntry,
    kind: input.kind,
    versions: {
      ...packageEntry.versions,
      [input.version]: version,
    },
  };

  await withHistory(paths, 'upsert-library-version', async () => {
    await writeSkillsFile(paths, file);
  });
  return { created: true };
}

export function getLibraryVersion(
  file: SkillsFile,
  name: string,
  version: string,
): LibraryVersion | undefined {
  return file.packages[name]?.versions[version];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export async function createTrashDirectory(paths: SkillinkPaths): Promise<string> {
  await mkdir(paths.trashDir, { recursive: true });

  let timestamp = Date.now();
  let directory = path.join(paths.trashDir, safeTimestamp(timestamp));
  while (
    await stat(directory)
      .then(() => true)
      .catch(() => false)
  ) {
    timestamp += 1;
    directory = path.join(paths.trashDir, safeTimestamp(timestamp));
  }

  await mkdir(directory, { recursive: true });
  return directory;
}

function safeTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replaceAll(':', '-');
}

async function moveToTrash(
  source: string,
  destination: string,
): Promise<boolean> {
  try {
    await lstat(source);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
  return true;
}

export async function setLibraryTag(
  paths: SkillinkPaths,
  name: string,
  version: string,
  tag: string,
): Promise<void> {
  if (!tag || tag.trim() !== tag) {
    throw new SkillinkError(
      'INVALID_NAME',
      'Library tag must be non-empty and have no leading/trailing whitespace.',
      { tag },
    );
  }

  const file = await readSkillsFile(paths);
  const packageEntry = file.packages[name];

  if (!packageEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${name}" is not in the public library.`,
      { name },
    );
  }

  if (!packageEntry.versions[version]) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${version}" of package "${name}" is not available.`,
      { name, version },
    );
  }

  file.packages[name] = {
    ...packageEntry,
    tags: {
      ...packageEntry.tags,
      [tag]: version,
    },
  };

  await withHistory(paths, 'set-library-tag', async () => {
    await writeSkillsFile(paths, file);
  });
}

export async function removeLibraryVersion(
  paths: SkillinkPaths,
  name: string,
  version: string,
): Promise<void> {
  const file = await readSkillsFile(paths);
  const packageEntry = file.packages[name];

  if (!packageEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${name}" is not in the public library.`,
      { name },
    );
  }

  if (!packageEntry.versions[version]) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${version}" of package "${name}" is not available.`,
      { name, version },
    );
  }

  const route = await readJsonFile(
    paths.routeFile,
    RouteFileSchema,
    createEmptyRouteFile(),
  );
  const reference = route.targets.find(
    (target) => target.skills[name]?.resolved === version,
  );

  if (reference) {
    throw new SkillinkError(
      'VERSION_IN_USE',
      `Version ${name}@${version} is still used by target "${reference.id}".`,
      { name, version, targetId: reference.id },
    );
  }

  await withHistory(paths, 'remove-library-version', async () => {
    const trashDirectory = await createTrashDirectory(paths);
    const source = getPackageDir(paths, name, version);
    const destination = path.join(trashDirectory, name, version);
    const moved = await moveToTrash(source, destination);

    const current = await readSkillsFile(paths);
    const currentPackage = current.packages[name];
    if (!currentPackage) {
      return;
    }

    const remainingVersions = { ...currentPackage.versions };
    delete remainingVersions[version];

    if (Object.keys(remainingVersions).length === 0) {
      delete current.packages[name];
    } else {
      const tags = Object.fromEntries(
        Object.entries(currentPackage.tags ?? {}).filter(
          ([, taggedVersion]) => taggedVersion !== version,
        ),
      );
      current.packages[name] = {
        ...currentPackage,
        versions: remainingVersions,
        ...(Object.keys(tags).length > 0 ? { tags } : { tags: undefined }),
      };
    }

    try {
      await writeSkillsFile(paths, current);
    } catch (error) {
      if (moved) {
        // Leave the content in trash if it cannot be moved back; never delete
        // the only remaining copy.
        await mkdir(path.dirname(source), { recursive: true });
        await rename(destination, source).catch(() => undefined);
      }
      throw error;
    }
  });
}
