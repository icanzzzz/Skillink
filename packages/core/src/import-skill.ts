import { randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  expandPath,
  getSkillDir,
  getSkillinkPaths,
  type ImportSkillResult,
} from '@skillink/shared';
import {
  DEFAULT_IMPORT_LIMITS,
  scanFolder,
  type ScanFolderOptions,
} from './folder-scan.js';
import { assertSafeImportSource } from './path-policy.js';
import { withFsRetry } from './fs-retry.js';
import { parseSkillFrontmatter } from './skill-md.js';
import { assertSkillIntegrity } from './skill-integrity.js';
import {
  assertSkillContent,
  readSkillFile,
  upsertSkillVersion,
} from './skill-store.js';
import {
  assertNoCaseInsensitiveCollision,
  assertSafePackageName,
  createAutoVersion,
  normalizeVersion,
} from './package-name.js';

export interface ImportSkillInput {
  sourceDir: string;
  name?: string;
  version?: string;
  home?: string;
  limits?: ScanFolderOptions;
}

function sourceError(message: string, sourceDir: string): SkillinkError {
  return new SkillinkError('IO_ERROR', message, { sourceDir });
}

export async function importSkill(
  input: ImportSkillInput,
): Promise<ImportSkillResult> {
  const paths = getSkillinkPaths(input.home);
  const sourceDir = path.resolve(expandPath(input.sourceDir));
  const sourceStat = await stat(sourceDir).catch((error: unknown) => {
    throw new SkillinkError(
      'IO_ERROR',
      `Source folder does not exist: ${sourceDir}`,
      { sourceDir },
      { cause: error },
    );
  });

  if (!sourceStat.isDirectory()) {
    throw sourceError(`Source is not a folder: ${sourceDir}`, sourceDir);
  }

  await assertSafeImportSource(sourceDir);
  const scan = await scanFolder(sourceDir, input.limits ?? DEFAULT_IMPORT_LIMITS);
  if (scan.kind !== 'skill') {
    throw new SkillinkError(
      'SKILL_MD_REQUIRED',
      `Skill root must contain SKILL.md: ${sourceDir}`,
      { sourceDir },
    );
  }

  const frontmatter = parseSkillFrontmatter(
    await readFile(path.join(sourceDir, 'SKILL.md'), 'utf8'),
  );
  const metadata = {
    ...(frontmatter?.name ? { name: frontmatter.name } : {}),
    ...(frontmatter?.metadata ?? {}),
  };
  const description = frontmatter?.description;

  const name = assertSafePackageName(input.name ?? path.basename(sourceDir));
  const version =
    normalizeVersion(input.version) ?? createAutoVersion(scan.manifestHash);
  const skillDir = getSkillDir(paths, name, version);
  const skillFile = await readSkillFile(paths);
  assertNoCaseInsensitiveCollision(Object.keys(skillFile.skills), name, 'skill');
  const existing = skillFile.skills[name]?.versions[version];

  if (existing) {
    if (existing.integrity === scan.integrity) {
      await assertSkillContent(paths, name, version);
      await assertSkillIntegrity(paths, name, version, existing);
      await upsertSkillVersion(paths, {
        name,
        version,
        integrity: scan.integrity,
        fileCount: existing.fileCount,
        size: existing.size,
        description,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      return {
        name,
        version,
        integrity: existing.integrity,
        path: skillDir,
        fileCount: existing.fileCount,
        size: existing.size,
        created: false,
      };
    }

    throw new SkillinkError(
      'PACKAGE_EXISTS',
      `Skill ${name}@${version} already exists with different content.`,
      {
        name,
        version,
        existingIntegrity: existing.integrity,
        incomingIntegrity: scan.integrity,
      },
    );
  }

  try {
    await lstat(skillDir);
    throw new SkillinkError(
      'PACKAGE_EXISTS',
      `Version directory already exists but is not in skill.json: ${skillDir}`,
      { name, version, skillDir },
    );
  } catch (error) {
    if (error instanceof SkillinkError) {
      throw error;
    }
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error;
    }
  }

  const stagingDir = path.join(paths.tmpDir, `import-${randomUUID()}`);
  await mkdir(stagingDir, { recursive: true });

  try {
    for (const directory of scan.directories) {
      await mkdir(path.join(stagingDir, directory.relativePath), {
        recursive: true,
      });
    }

    for (const file of scan.files) {
      const destination = path.join(stagingDir, file.relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await withFsRetry(() =>
        copyFile(path.join(sourceDir, file.relativePath), destination),
      );
      await chmod(destination, file.mode).catch(() => undefined);
    }

    const directories = [...scan.directories].sort((left, right) => {
      const depth = right.relativePath.split('/').length -
        left.relativePath.split('/').length;
      return depth !== 0
        ? depth
        : right.relativePath.localeCompare(left.relativePath);
    });
    for (const directory of directories) {
      await chmod(
        path.join(stagingDir, directory.relativePath),
        directory.mode,
      );
    }

    const stagedScan = await scanFolder(stagingDir);
    if (stagedScan.integrity !== scan.integrity) {
      throw new SkillinkError(
        'SKILL_INTEGRITY_MISMATCH',
        `Imported content does not match the scanned source: ${sourceDir}`,
        {
          sourceDir,
          expected: scan.integrity,
          actual: stagedScan.integrity,
        },
      );
    }

    await mkdir(path.dirname(skillDir), { recursive: true });
    await withFsRetry(() => rename(stagingDir, skillDir));
  } catch (error) {
    await withFsRetry(() =>
      rm(stagingDir, { recursive: true, force: true }),
    ).catch(() => undefined);
    throw error;
  }

  try {
    await upsertSkillVersion(paths, {
      name,
      version,
      integrity: scan.integrity,
      fileCount: scan.fileCount,
      size: scan.totalSize,
      description,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  } catch (error) {
    await withFsRetry(() =>
      rm(skillDir, { recursive: true, force: true }),
    ).catch(() => undefined);
    throw error;
  }

  return {
    name,
    version,
    integrity: scan.integrity,
    path: skillDir,
    fileCount: scan.fileCount,
    size: scan.totalSize,
    created: true,
  };
}
