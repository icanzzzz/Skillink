import { copyFile, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  PackageFileSchema,
  RouteFileSchema,
  SkillFileSchema,
  SkillinkError,
  getSkillDir,
  type PackageEntry,
  type PackageFile,
  type PackageLock,
  type RouteFile,
  type SkillEntry,
  type SkillFile,
  type SkillinkPaths,
  type TargetRoute,
} from '@skillink/shared';
import { createTrashDirectory } from './skill-store.js';
import {
  computePackageIntegrity,
  resolvePackageGraph,
  validateAllPackages,
} from './package-graph.js';
import { isSamePath } from './path-policy.js';
import { writeJsonAtomic } from './json-store.js';
import { isNodeError } from './node-error.js';

const LegacyVersionSchema = z.object({
  integrity: z.string().min(1),
  source: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  built: z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const LegacyEntrySchema = z.object({
  description: z.string().optional(),
  kind: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  versions: z.record(z.string(), LegacyVersionSchema),
});

const LegacySkillsFileSchema = z.object({
  schemaVersion: z.literal(1),
  packages: z.record(z.string(), LegacyEntrySchema),
});

const LegacyLockSchema = z.object({
  requested: z.string().optional(),
  resolved: z.string().min(1),
  integrity: z.string().min(1),
  source: z.string().min(1),
  enabled: z.boolean().optional(),
});

const LegacyTargetSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  path: z.string().min(1),
  mode: z.enum(['link', 'copy']),
  enabled: z.boolean().optional(),
  skills: z.record(z.string(), LegacyLockSchema),
});

const LegacyRouteFileSchema = z.object({
  schemaVersion: z.literal(1),
  targets: z.array(LegacyTargetSchema),
});

type LegacySkillsFile = z.infer<typeof LegacySkillsFileSchema>;
type LegacyRouteFile = z.infer<typeof LegacyRouteFileSchema>;

async function pathExists(target: string): Promise<boolean> {
  return stat(target)
    .then(() => true)
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

async function isDirectory(target: string): Promise<boolean> {
  return stat(target)
    .then((info) => info.isDirectory())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

async function isFile(target: string): Promise<boolean> {
  return stat(target)
    .then((info) => info.isFile())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    });
}

async function readLegacySkills(
  paths: SkillinkPaths,
): Promise<LegacySkillsFile> {
  try {
    return LegacySkillsFileSchema.parse(
      JSON.parse(await readFile(paths.skillsFile, 'utf8')),
    );
  } catch (error) {
    throw new SkillinkError(
      'IO_ERROR',
      `Invalid v1 skills.json: ${paths.skillsFile}`,
      { file: paths.skillsFile },
      { cause: error },
    );
  }
}

async function readLegacyRoute(
  paths: SkillinkPaths,
): Promise<LegacyRouteFile> {
  if (!(await pathExists(paths.routeFile))) {
    return { schemaVersion: 1, targets: [] };
  }

  try {
    return LegacyRouteFileSchema.parse(
      JSON.parse(await readFile(paths.routeFile, 'utf8')),
    );
  } catch (error) {
    throw new SkillinkError(
      'IO_ERROR',
      `Invalid v1 route.json: ${paths.routeFile}`,
      { file: paths.routeFile },
      { cause: error },
    );
  }
}

export interface MigrationResult {
  migrated: boolean;
  skillCount: number;
  packageCount: number;
  targetCount: number;
}

export async function migrateV1ToV2(
  paths: SkillinkPaths,
): Promise<MigrationResult> {
  if (!(await pathExists(paths.skillsFile))) {
    return {
      migrated: false,
      skillCount: 0,
      packageCount: 0,
      targetCount: 0,
    };
  }

  if (
    (await pathExists(paths.skillFile)) ||
    (await pathExists(paths.packageFile))
  ) {
    throw new SkillinkError(
      'PACKAGE_EXISTS',
      'Migration target already exists; skill.json or package.json is present.',
      {
        skillFile: paths.skillFile,
        packageFile: paths.packageFile,
      },
    );
  }

  const legacySkills = await readLegacySkills(paths);
  const legacyRoute = await readLegacyRoute(paths);
  const problems: string[] = [];

  for (const [name, entry] of Object.entries(legacySkills.packages)) {
    const versions = Object.keys(entry.versions);
    if (versions.length === 0) {
      problems.push(`Package "${name}" has no versions.`);
      continue;
    }

    for (const [version, versionEntry] of Object.entries(entry.versions)) {
      const contentDir = getSkillDir(paths, name, version);
      const sourceDir = path.resolve(paths.home, versionEntry.source);

      if (!isSamePath(sourceDir, contentDir)) {
        problems.push(
          `Package "${name}@${version}" source does not match the skill library layout.`,
        );
        continue;
      }

      if (!(await isDirectory(contentDir))) {
        problems.push(
          `Package "${name}@${version}" content directory is missing.`,
        );
        continue;
      }

      if (!(await isFile(path.join(contentDir, 'SKILL.md')))) {
        problems.push(`Package "${name}@${version}" has no SKILL.md.`);
      }
    }

    for (const [tag, taggedVersion] of Object.entries(entry.tags ?? {})) {
      if (!entry.versions[taggedVersion]) {
        problems.push(
          `Package "${name}" tag "${tag}" points to missing version "${taggedVersion}".`,
        );
      }
    }
  }

  for (const target of legacyRoute.targets) {
    for (const [name, lock] of Object.entries(target.skills)) {
      const entry = legacySkills.packages[name];
      const versionEntry = entry?.versions[lock.resolved];

      if (!entry || !versionEntry) {
        problems.push(
          `Target "${target.id}" references missing skill "${name}@${lock.resolved}".`,
        );
        continue;
      }

      if (versionEntry.integrity !== lock.integrity) {
        problems.push(
          `Target "${target.id}" lock integrity does not match skill "${name}@${lock.resolved}".`,
        );
      }
      if (versionEntry.source !== lock.source) {
        problems.push(
          `Target "${target.id}" lock source does not match skill "${name}@${lock.resolved}".`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new SkillinkError(
      'IO_ERROR',
      `Cannot migrate v1 data:\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
      { problems },
    );
  }

  const skillFile: SkillFile = { schemaVersion: 2, skills: {} };
  const packageFile: PackageFile = { schemaVersion: 2, packages: {} };

  for (const [name, entry] of Object.entries(legacySkills.packages)) {
    const skillEntry: SkillEntry = {
      ...(entry.description !== undefined
        ? { description: entry.description }
        : {}),
      ...(entry.tags ? { tags: { ...entry.tags } } : {}),
      versions: {},
    };
    const packageEntry: PackageEntry = {
      ...(entry.description !== undefined
        ? { description: entry.description }
        : {}),
      ...(entry.tags ? { tags: { ...entry.tags } } : {}),
      versions: {},
    };

    for (const [version, versionEntry] of Object.entries(entry.versions)) {
      skillEntry.versions[version] = {
        integrity: versionEntry.integrity,
        fileCount: versionEntry.fileCount,
        size: versionEntry.size,
        built: versionEntry.built ?? false,
        ...(versionEntry.metadata
          ? { metadata: { ...versionEntry.metadata } }
          : {}),
      };
      packageEntry.versions[version] = {
        packages: {},
        skills: { [name]: version },
      };
    }

    skillFile.skills[name] = skillEntry;
    packageFile.packages[name] = packageEntry;
  }

  const newRoute: RouteFile = {
    schemaVersion: 2,
    targets: legacyRoute.targets.map((target) => {
      const packages: Record<string, PackageLock> = {};

      for (const [name, lock] of Object.entries(target.skills)) {
        packages[name] = {
          ...(lock.requested !== undefined
            ? { requested: lock.requested }
            : {}),
          resolved: lock.resolved,
          integrity: computePackageIntegrity(packageFile, [
            { name, version: lock.resolved },
          ]),
          enabled: lock.enabled ?? true,
        };
      }

      const routeTarget: TargetRoute = {
        id: target.id,
        ...(target.label !== undefined ? { label: target.label } : {}),
        path: target.path,
        mode: target.mode,
        enabled: target.enabled ?? true,
        packages,
      };
      return routeTarget;
    }),
  };

  validateAllPackages(packageFile, skillFile);
  for (const target of newRoute.targets) {
    resolvePackageGraph(
      packageFile,
      skillFile,
      Object.entries(target.packages)
        .filter(([, lock]) => lock.enabled !== false)
        .map(([name, lock]) => ({
          name,
          version: lock.resolved,
        })),
    );
  }

  const trashDirectory = await createTrashDirectory(paths);
  const backupSkills = path.join(trashDirectory, 'skills.json');
  const backupRoute = path.join(trashDirectory, 'route.v1.json');
  const hadRoute = await pathExists(paths.routeFile);

  await copyFile(paths.skillsFile, backupSkills);
  if (hadRoute) {
    await copyFile(paths.routeFile, backupRoute);
  }

  try {
    await writeJsonAtomic(paths.skillFile, skillFile, SkillFileSchema);
    await writeJsonAtomic(paths.packageFile, packageFile, PackageFileSchema);
    await writeJsonAtomic(paths.routeFile, newRoute, RouteFileSchema);
    await rm(paths.skillsFile, { force: true });
  } catch (error) {
    await rm(paths.skillFile, { force: true });
    await rm(paths.packageFile, { force: true });

    if (hadRoute) {
      await copyFile(backupRoute, paths.routeFile);
    } else {
      await rm(paths.routeFile, { force: true });
    }

    throw error;
  }

  return {
    migrated: true,
    skillCount: Object.keys(skillFile.skills).length,
    packageCount: Object.keys(packageFile.packages).length,
    targetCount: newRoute.targets.length,
  };
}
