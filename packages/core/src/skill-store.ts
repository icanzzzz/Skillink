import { rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  PackageFileSchema,
  RouteFileSchema,
  SkillFileSchema,
  SkillinkError,
  assertSafeVersion,
  createEmptyPackageFile,
  createEmptyRouteFile,
  createEmptySkillFile,
  getSkillDir,
  type SkillFile,
  type SkillVersion,
  type SkillinkPaths,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';
import { collectPackageSkillRefs } from './package-graph.js';
import { withFsRetry } from './fs-retry.js';
import { assertSafePackageName } from './package-name.js';
import { isNodeError } from './node-error.js';

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
  if (!Object.hasOwn(file.skills, name)) {
    return undefined;
  }
  const entry = file.skills[name]!;
  return Object.hasOwn(entry.versions, version)
    ? entry.versions[version]
    : undefined;
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
  const name = assertSafePackageName(input.name);
  const version = assertSafeVersion(input.version);
  const file = await readSkillFile(paths);
  const skillEntry = Object.hasOwn(file.skills, name)
    ? file.skills[name]!
    : { versions: {} };
  const existing = Object.hasOwn(skillEntry.versions, version)
    ? skillEntry.versions[version]
    : undefined;

  if (existing) {
    if (existing.integrity !== input.integrity) {
      throw new SkillinkError(
        'PACKAGE_EXISTS',
        `Skill ${name}@${version} already exists with different content.`,
        {
          name,
          version,
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

    await writeSkillFile(paths, file);
    return { created: false };
  }

  const skillVersion: SkillVersion = {
    integrity: input.integrity,
    fileCount: input.fileCount,
    size: input.size,
    built: input.built ?? false,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  file.skills[name] = {
    ...skillEntry,
    ...(skillEntry.description === undefined && input.description !== undefined
      ? { description: input.description }
      : {}),
    versions: {
      ...skillEntry.versions,
      [version]: skillVersion,
    },
  };

  await writeSkillFile(paths, file);
  return { created: true };
}

export async function removeEmptySkillParent(
  paths: SkillinkPaths,
  name: string,
): Promise<void> {
  await rmdir(path.join(paths.libraryDir, name)).catch(() => undefined);
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

  const safeName = assertSafePackageName(name);
  const safeVersion = assertSafeVersion(version);
  const file = await readSkillFile(paths);
  const skillEntry = Object.hasOwn(file.skills, safeName)
    ? file.skills[safeName]
    : undefined;

  if (!skillEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Skill "${safeName}" is not in skill.json.`,
      { name: safeName },
    );
  }

  if (!Object.hasOwn(skillEntry.versions, safeVersion)) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${safeVersion}" of skill "${safeName}" is not available.`,
      { name: safeName, version: safeVersion },
    );
  }

  file.skills[safeName] = {
    ...skillEntry,
    tags: {
      ...skillEntry.tags,
      [tag]: safeVersion,
    },
  };

  await writeSkillFile(paths, file);
}

export async function removeSkillVersion(
  paths: SkillinkPaths,
  name: string,
  version: string,
): Promise<void> {
  const safeName = assertSafePackageName(name);
  const safeVersion = assertSafeVersion(version);
  const file = await readSkillFile(paths);
  const skillEntry = Object.hasOwn(file.skills, safeName)
    ? file.skills[safeName]
    : undefined;

  if (!skillEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Skill "${safeName}" is not in skill.json.`,
      { name: safeName },
    );
  }

  if (!Object.hasOwn(skillEntry.versions, safeVersion)) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${safeVersion}" of skill "${safeName}" is not available.`,
      { name: safeName, version: safeVersion },
    );
  }

  if (Object.values(skillEntry.tags ?? {}).includes(safeVersion)) {
    throw new SkillinkError(
      'VERSION_IN_USE',
      `Version ${safeName}@${safeVersion} is still referenced by a tag.`,
      { name: safeName, version: safeVersion },
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
    if (referenced.has(`${safeName}@${safeVersion}`)) {
      throw new SkillinkError(
        'VERSION_IN_USE',
        `Version ${safeName}@${safeVersion} is still referenced by a route package.`,
        { name: safeName, version: safeVersion },
      );
    }
  }

  const versionDir = getSkillDir(paths, safeName, safeVersion);
  try {
    await withFsRetry(() =>
      rm(versionDir, { recursive: true, force: true }),
    );
  } catch (error) {
    throw new SkillinkError(
      'IO_ERROR',
      `Failed to delete skill content: ${versionDir}`,
      { name: safeName, version: safeVersion, path: versionDir },
      { cause: error },
    );
  }

  const nextSkills = { ...file.skills };
  const remainingVersions = { ...skillEntry.versions };
  delete remainingVersions[safeVersion];

  if (Object.keys(remainingVersions).length === 0) {
    delete nextSkills[safeName];
  } else {
    const tags = Object.fromEntries(
      Object.entries(skillEntry.tags ?? {}).filter(
        ([, taggedVersion]) => taggedVersion !== safeVersion,
      ),
    );
    nextSkills[safeName] = {
      ...skillEntry,
      versions: remainingVersions,
      ...(Object.keys(tags).length > 0 ? { tags } : { tags: undefined }),
    };
  }

  await writeSkillFile(paths, {
    ...file,
    skills: nextSkills,
  });

  if (!Object.hasOwn(nextSkills, safeName)) {
    await removeEmptySkillParent(paths, safeName);
  }
}
