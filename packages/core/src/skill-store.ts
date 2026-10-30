import { lstat, mkdir, rename, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  PackageFileSchema,
  RouteFileSchema,
  SkillFileSchema,
  SkillinkError,
  createEmptyPackageFile,
  createEmptyRouteFile,
  createEmptySkillFile,
  getSkillDir,
  type SkillFile,
  type SkillVersion,
  type SkillinkPaths,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';
import { withHistory } from './history.js';
import { collectPackageSkillRefs } from './package-graph.js';
import { withFsRetry } from './fs-retry.js';

export async function readSkillFile(paths: SkillinkPaths): Promise<SkillFile> {
  return readJsonFile(paths.skillFile, SkillFileSchema, createEmptySkillFile());
}

export async function writeSkillFile(
  paths: SkillinkPaths,
  file: SkillFile,
): Promise<void> {
  await writeJsonAtomic(paths.skillFile, file, SkillFileSchema);
}

export function getSkillVersion(
  file: SkillFile,
  name: string,
  version: string,
): SkillVersion | undefined {
  return file.skills[name]?.versions[version];
}

export async function assertSkillContent(
  paths: SkillinkPaths,
  name: string,
  version: string,
): Promise<string> {
  const directory = getSkillDir(paths, name, version);
  const info = await stat(directory).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });

  if (!info?.isDirectory()) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Skill content is missing: ${name}@${version}`,
      { name, version, path: directory },
    );
  }

  const hasSkillMd = await stat(path.join(directory, 'SKILL.md'))
    .then((entry) => entry.isFile())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });

  if (!hasSkillMd) {
    throw new SkillinkError(
      'SKILL_MD_MISSING',
      `Skill content has no SKILL.md: ${name}@${version}`,
      { name, version, path: directory },
    );
  }

  return directory;
}

export interface UpsertSkillVersionInput {
  name: string;
  version: string;
  integrity: string;
  fileCount: number;
  size: number;
  built?: boolean;
  metadata?: Record<string, string>;
  description?: string;
}

export async function upsertSkillVersion(
  paths: SkillinkPaths,
  input: UpsertSkillVersionInput,
): Promise<{ created: boolean }> {
  const file = await readSkillFile(paths);
  const skillEntry = file.skills[input.name] ?? { versions: {} };
  const existing = skillEntry.versions[input.version];

  if (existing) {
    if (existing.integrity !== input.integrity) {
      throw new SkillinkError(
        'PACKAGE_EXISTS',
        `Skill ${input.name}@${input.version} already exists with different content.`,
        {
          name: input.name,
          version: input.version,
          existingIntegrity: existing.integrity,
          incomingIntegrity: input.integrity,
        },
      );
    }

    const nextDescription =
      skillEntry.description === undefined
        ? input.description
        : skillEntry.description;
    const nextMetadata = {
      ...(input.metadata ?? {}),
      ...(existing.metadata ?? {}),
    };
    const descriptionChanged =
      nextDescription !== undefined &&
      nextDescription !== skillEntry.description;
    const metadataChanged =
      Object.keys(nextMetadata).length > 0 &&
      JSON.stringify(nextMetadata) !== JSON.stringify(existing.metadata ?? {});

    if (!descriptionChanged && !metadataChanged) {
      return { created: false };
    }

    if (descriptionChanged) {
      skillEntry.description = nextDescription;
    }
    if (metadataChanged) {
      existing.metadata = nextMetadata;
    }

    await withHistory(paths, 'refresh-skill-metadata', async () => {
      await writeSkillFile(paths, file);
    });
    return { created: false };
  }

  const version: SkillVersion = {
    integrity: input.integrity,
    fileCount: input.fileCount,
    size: input.size,
    built: input.built ?? false,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  file.skills[input.name] = {
    ...skillEntry,
    ...(skillEntry.description === undefined && input.description !== undefined
      ? { description: input.description }
      : {}),
    versions: {
      ...skillEntry.versions,
      [input.version]: version,
    },
  };

  await withHistory(paths, 'upsert-skill-version', async () => {
    await writeSkillFile(paths, file);
  });
  return { created: true };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export async function createTrashDirectory(
  paths: SkillinkPaths,
): Promise<string> {
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

export async function removeEmptySkillParent(
  paths: SkillinkPaths,
  name: string,
): Promise<void> {
  await rmdir(path.join(paths.libraryDir, name)).catch(() => undefined);
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
  await withFsRetry(() => rename(source, destination));
  return true;
}

export async function setSkillTag(
  paths: SkillinkPaths,
  name: string,
  version: string,
  tag: string,
): Promise<void> {
  if (!tag || tag.trim() !== tag) {
    throw new SkillinkError(
      'INVALID_NAME',
      'Skill tag must be non-empty and have no leading/trailing whitespace.',
      { tag },
    );
  }

  const file = await readSkillFile(paths);
  const skillEntry = file.skills[name];

  if (!skillEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Skill "${name}" is not in skill.json.`,
      { name },
    );
  }

  if (!skillEntry.versions[version]) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${version}" of skill "${name}" is not available.`,
      { name, version },
    );
  }

  file.skills[name] = {
    ...skillEntry,
    tags: {
      ...skillEntry.tags,
      [tag]: version,
    },
  };

  await withHistory(paths, 'set-skill-tag', async () => {
    await writeSkillFile(paths, file);
  });
}

export async function removeSkillVersion(
  paths: SkillinkPaths,
  name: string,
  version: string,
): Promise<void> {
  const file = await readSkillFile(paths);
  const skillEntry = file.skills[name];

  if (!skillEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Skill "${name}" is not in skill.json.`,
      { name },
    );
  }

  if (!skillEntry.versions[version]) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${version}" of skill "${name}" is not available.`,
      { name, version },
    );
  }

  if (Object.values(skillEntry.tags ?? {}).includes(version)) {
    throw new SkillinkError(
      'VERSION_IN_USE',
      `Version ${name}@${version} is still referenced by a tag.`,
      { name, version },
    );
  }

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
  const roots = route.targets.flatMap((target) =>
    Object.entries(target.packages).map(([packageName, lock]) => ({
      name: packageName,
      version: lock.resolved,
    })),
  );

  if (roots.length > 0) {
    const referenced = collectPackageSkillRefs(packages, roots);
    if (referenced.has(`${name}@${version}`)) {
      throw new SkillinkError(
        'VERSION_IN_USE',
        `Version ${name}@${version} is still referenced by a route package.`,
        { name, version },
      );
    }
  }

  await withHistory(paths, 'remove-skill-version', async () => {
    const trashDirectory = await createTrashDirectory(paths);
    const source = getSkillDir(paths, name, version);
    const destination = path.join(trashDirectory, name, version);
    const moved = await moveToTrash(source, destination);

    const current = await readSkillFile(paths);
    const currentSkill = current.skills[name];
    if (!currentSkill) {
      return;
    }

    const remainingVersions = { ...currentSkill.versions };
    delete remainingVersions[version];

    if (Object.keys(remainingVersions).length === 0) {
      delete current.skills[name];
    } else {
      const tags = Object.fromEntries(
        Object.entries(currentSkill.tags ?? {}).filter(
          ([, taggedVersion]) => taggedVersion !== version,
        ),
      );
      current.skills[name] = {
        ...currentSkill,
        versions: remainingVersions,
        ...(Object.keys(tags).length > 0 ? { tags } : { tags: undefined }),
      };
    }

    try {
      await writeSkillFile(paths, current);
      if (!current.skills[name]) {
        await removeEmptySkillParent(paths, name);
      }
    } catch (error) {
      if (moved) {
        await mkdir(path.dirname(source), { recursive: true });
        await withFsRetry(() => rename(destination, source)).catch(
          () => undefined,
        );
      }
      throw error;
    }
  });
}
