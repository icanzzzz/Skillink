import semver from 'semver';
import {
  PackageFileSchema,
  RouteFileSchema,
  SkillinkError,
  createEmptyPackageFile,
  createEmptyRouteFile,
  type PackageEntry,
  type PackageFile,
  type PackageVersion,
  type SkillinkPaths,
} from '@skillink/shared';
import { readJsonFile, writeJsonAtomic } from './json-store.js';
import { withHistory } from './history.js';
import { assertSkillContent, readSkillFile } from './skill-store.js';
import {
  resolvePackageGraph,
  validateAllPackages,
} from './package-graph.js';
import {
  assertNoCaseInsensitiveCollision,
  assertSafePackageName,
  normalizeVersion,
} from './package-name.js';

export async function readPackageFile(
  paths: SkillinkPaths,
): Promise<PackageFile> {
  return readJsonFile(
    paths.packageFile,
    PackageFileSchema,
    createEmptyPackageFile(),
  );
}

export async function writePackageFile(
  paths: SkillinkPaths,
  file: PackageFile,
): Promise<void> {
  await writeJsonAtomic(paths.packageFile, file, PackageFileSchema);
}

export interface ResolvedPackageVersion {
  version: string;
  entry: PackageVersion;
}

export function resolvePackageVersion(
  file: PackageFile,
  requestedName: string,
  requested: string,
): ResolvedPackageVersion {
  const name = assertSafePackageName(requestedName);
  const packageEntry = Object.hasOwn(file.packages, name)
    ? file.packages[name]
    : undefined;

  if (!packageEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${name}" is not defined in package.json.`,
      { name },
    );
  }

  const versions = Object.keys(packageEntry.versions);
  const taggedVersion = packageEntry.tags?.[requested];
  const directVersion = packageEntry.versions[requested] ? requested : undefined;
  const rangeVersion =
    taggedVersion || directVersion
      ? undefined
      : semver.maxSatisfying(versions, requested);

  const resolved = taggedVersion ?? directVersion ?? rangeVersion;

  if (!resolved) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${requested}" of package "${name}" is not available.`,
      { name, requested, available: versions },
    );
  }

  const entry = packageEntry.versions[resolved];
  if (!entry) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${resolved}" of package "${name}" is missing from package.json.`,
      { name, resolved },
    );
  }

  return { version: resolved, entry };
}

function assertVersion(version: string | undefined): string {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    throw new SkillinkError('INVALID_VERSION', 'Version must be non-empty.', {
      version,
    });
  }
  return normalized;
}

function assertPackageVersionInput(input: {
  packages: Record<string, string>;
  skills: Record<string, string>;
}): void {
  if (
    Object.keys(input.packages).length + Object.keys(input.skills).length ===
    0
  ) {
    throw new SkillinkError(
      'PACKAGE_EMPTY',
      'Package version must contain at least one package or skill.',
    );
  }
}

function packageVersionEntry(input: {
  packages: Record<string, string>;
  skills: Record<string, string>;
}): PackageVersion {
  return {
    packages: input.packages,
    skills: input.skills,
  };
}

export interface CreatePackageVersionInput {
  paths: SkillinkPaths;
  name: string;
  version: string;
  description?: string;
  packages?: Record<string, string>;
  skills?: Record<string, string>;
}

export async function createPackageVersion(
  input: CreatePackageVersionInput,
): Promise<PackageVersion> {
  const name = assertSafePackageName(input.name);
  const version = assertVersion(input.version);
  const packages = input.packages ?? {};
  const skills = input.skills ?? {};
  assertPackageVersionInput({ packages, skills });

  const file = await readPackageFile(input.paths);
  const skillFile = await readSkillFile(input.paths);
  assertNoCaseInsensitiveCollision(Object.keys(file.packages), name, 'package');
  const packageEntry = file.packages[name] ?? { versions: {} };

  if (packageEntry.versions[version]) {
    throw new SkillinkError(
      'PACKAGE_EXISTS',
      `Package ${name}@${version} already exists.`,
      { name, version },
    );
  }

  const nextPackageEntry: PackageEntry = {
    ...packageEntry,
    ...(packageEntry.description === undefined && input.description !== undefined
      ? { description: input.description }
      : {}),
    versions: {
      ...packageEntry.versions,
      [version]: packageVersionEntry({ packages, skills }),
    },
  };

  const candidate: PackageFile = {
    ...file,
    packages: {
      ...file.packages,
      [name]: nextPackageEntry,
    },
  };

  validateAllPackages(candidate, skillFile);
  const resolution = resolvePackageGraph(candidate, skillFile, [
    { name, version },
  ]);
  for (const skill of resolution.skills.values()) {
    await assertSkillContent(input.paths, skill.name, skill.version);
  }

  await withHistory(input.paths, 'create-package-version', async () => {
    await writePackageFile(input.paths, candidate);
  });

  return nextPackageEntry.versions[version]!;
}

export interface CopyPackageVersionInput {
  paths: SkillinkPaths;
  sourceName: string;
  sourceVersion: string;
  targetName: string;
  targetVersion: string;
  description?: string;
  skillOverrides?: Record<string, string>;
  packageOverrides?: Record<string, string>;
  dropSkills?: string[];
  dropPackages?: string[];
}

export async function copyPackageVersion(
  input: CopyPackageVersionInput,
): Promise<PackageVersion> {
  const targetName = assertSafePackageName(input.targetName);
  const sourceName = assertSafePackageName(input.sourceName);
  const targetVersion = assertVersion(input.targetVersion);

  const file = await readPackageFile(input.paths);
  const skillFile = await readSkillFile(input.paths);
  assertNoCaseInsensitiveCollision(Object.keys(file.packages), targetName, 'package');
  const sourcePackage = Object.hasOwn(file.packages, sourceName)
    ? file.packages[sourceName]
    : undefined;

  if (!sourcePackage) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${sourceName}" is not defined in package.json.`,
      { name: sourceName },
    );
  }

  const sourceVersion = Object.hasOwn(
    sourcePackage.versions,
    input.sourceVersion,
  )
    ? sourcePackage.versions[input.sourceVersion]
    : undefined;
  if (!sourceVersion) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${input.sourceVersion}" of package "${sourceName}" is not defined in package.json.`,
      { name: sourceName, version: input.sourceVersion },
    );
  }

  const targetPackage = file.packages[targetName];
  if (targetPackage?.versions[targetVersion]) {
    throw new SkillinkError(
      'PACKAGE_EXISTS',
      `Package ${targetName}@${targetVersion} already exists.`,
      { name: targetName, version: targetVersion },
    );
  }

  const packages = { ...sourceVersion.packages };
  const skills = { ...sourceVersion.skills };

  for (const [name, version] of Object.entries(input.packageOverrides ?? {})) {
    packages[name] = assertVersion(version);
  }
  for (const [name, version] of Object.entries(input.skillOverrides ?? {})) {
    skills[name] = assertVersion(version);
  }
  for (const name of input.dropPackages ?? []) {
    delete packages[name];
  }
  for (const name of input.dropSkills ?? []) {
    delete skills[name];
  }

  assertPackageVersionInput({ packages, skills });

  const nextTargetPackage: PackageEntry = targetPackage ?? { versions: {} };
  const description =
    input.description ??
    (targetName === sourceName
      ? nextTargetPackage.description
      : sourcePackage.description);

  const nextPackageEntry: PackageEntry = {
    ...nextTargetPackage,
    ...(description !== undefined ? { description } : {}),
    versions: {
      ...nextTargetPackage.versions,
      [targetVersion]: packageVersionEntry({ packages, skills }),
    },
  };

  const candidate: PackageFile = {
    ...file,
    packages: {
      ...file.packages,
      [targetName]: nextPackageEntry,
    },
  };

  validateAllPackages(candidate, skillFile);
  const resolution = resolvePackageGraph(candidate, skillFile, [
    { name: targetName, version: targetVersion },
  ]);
  for (const skill of resolution.skills.values()) {
    await assertSkillContent(input.paths, skill.name, skill.version);
  }

  await withHistory(input.paths, 'copy-package-version', async () => {
    await writePackageFile(input.paths, candidate);
  });

  return nextPackageEntry.versions[targetVersion]!;
}

export async function setPackageTag(
  paths: SkillinkPaths,
  name: string,
  version: string,
  tag: string,
): Promise<void> {
  if (!tag || tag.trim() !== tag) {
    throw new SkillinkError(
      'INVALID_NAME',
      'Package tag must be non-empty and have no leading/trailing whitespace.',
      { tag },
    );
  }

  const safeName = assertSafePackageName(name);
  const file = await readPackageFile(paths);
  const skillFile = await readSkillFile(paths);
  const packageEntry = Object.hasOwn(file.packages, safeName)
    ? file.packages[safeName]
    : undefined;

  if (!packageEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${safeName}" is not defined in package.json.`,
      { name: safeName },
    );
  }

  if (!Object.hasOwn(packageEntry.versions, version)) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${version}" of package "${safeName}" is not available.`,
      { name: safeName, version },
    );
  }

  validateAllPackages(file, skillFile);

  file.packages[safeName] = {
    ...packageEntry,
    tags: {
      ...packageEntry.tags,
      [tag]: version,
    },
  };

  await withHistory(paths, 'set-package-tag', async () => {
    await writePackageFile(paths, file);
  });
}

export function listPackageReverseReferences(
  file: PackageFile,
  name: string,
  version: string,
): string[] {
  const references: string[] = [];

  for (const [packageName, packageEntry] of Object.entries(file.packages)) {
    for (const [packageVersion, versionEntry] of Object.entries(
      packageEntry.versions,
    )) {
      if (packageName === name && packageVersion === version) {
        continue;
      }
      if (
        Object.hasOwn(versionEntry.packages, name) &&
        versionEntry.packages[name] === version
      ) {
        references.push(`${packageName}@${packageVersion}`);
      }
    }
  }

  return references;
}

export async function removePackageVersion(
  paths: SkillinkPaths,
  name: string,
  version: string,
): Promise<void> {
  const safeName = assertSafePackageName(name);
  const file = await readPackageFile(paths);
  const skillFile = await readSkillFile(paths);
  const packageEntry = Object.hasOwn(file.packages, safeName)
    ? file.packages[safeName]
    : undefined;

  if (!packageEntry) {
    throw new SkillinkError(
      'PACKAGE_NOT_FOUND',
      `Package "${safeName}" is not defined in package.json.`,
      { name: safeName },
    );
  }

  if (!Object.hasOwn(packageEntry.versions, version)) {
    throw new SkillinkError(
      'VERSION_NOT_FOUND',
      `Version "${version}" of package "${safeName}" is not available.`,
      { name: safeName, version },
    );
  }

  const route = await readJsonFile(
    paths.routeFile,
    RouteFileSchema,
    createEmptyRouteFile(),
  );
  const routeReference = route.targets.find(
    (target) =>
      Object.hasOwn(target.packages, safeName) &&
      target.packages[safeName]?.resolved === version,
  );

  if (routeReference) {
    throw new SkillinkError(
      'VERSION_IN_USE',
      `Package ${safeName}@${version} is still used by target "${routeReference.id}".`,
      { name: safeName, version, targetId: routeReference.id },
    );
  }

  const reverseReferences = listPackageReverseReferences(
    file,
    safeName,
    version,
  );
  if (reverseReferences.length > 0) {
    throw new SkillinkError(
      'PACKAGE_IN_USE',
      `Package ${safeName}@${version} is still referenced by ${reverseReferences.join(', ')}.`,
      { name: safeName, version, referencedBy: reverseReferences },
    );
  }

  const remainingVersions = { ...packageEntry.versions };
  delete remainingVersions[version];

  const packages = { ...file.packages };
  if (Object.keys(remainingVersions).length === 0) {
    delete packages[safeName];
  } else {
    const tags = Object.fromEntries(
      Object.entries(packageEntry.tags ?? {}).filter(
        ([, taggedVersion]) => taggedVersion !== version,
      ),
    );
    packages[safeName] = {
      ...packageEntry,
      versions: remainingVersions,
      ...(Object.keys(tags).length > 0 ? { tags } : { tags: undefined }),
    };
  }

  const candidate: PackageFile = { ...file, packages };
  validateAllPackages(candidate, skillFile);

  await withHistory(paths, 'remove-package-version', async () => {
    await writePackageFile(paths, candidate);
  });
}
