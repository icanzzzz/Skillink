import { randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import {
  SkillinkError,
  getSkillDir,
  getSkillinkPaths,
} from '@skillink/shared';
import { scanFolder } from './folder-scan.js';
import { readSkillFile, upsertSkillVersion } from './skill-store.js';
import {
  assertSafePackageName,
  createAutoVersion,
  normalizeVersion,
} from './package-name.js';

export interface ImportSkillInput {
  sourceDir: string;
  name?: string;
  version?: string;
  home?: string;
}

export interface ImportSkillResult {
  name: string;
  version: string;
  integrity: string;
  path: string;
  fileCount: number;
  size: number;
  created: boolean;
}

function sourceError(message: string, sourceDir: string): SkillinkError {
  return new SkillinkError('IO_ERROR', message, { sourceDir });
}

export async function importSkill(
  input: ImportSkillInput,
): Promise<ImportSkillResult> {
  const paths = getSkillinkPaths(input.home);
  const sourceDir = path.resolve(input.sourceDir);
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

  const scan = await scanFolder(sourceDir);
  if (scan.kind !== 'skill') {
    throw new SkillinkError(
      'SKILL_MD_REQUIRED',
      `Skill root must contain SKILL.md: ${sourceDir}`,
      { sourceDir },
    );
  }

  const name = assertSafePackageName(input.name ?? path.basename(sourceDir));
  const version =
    normalizeVersion(input.version) ?? createAutoVersion(scan.manifestHash);
  const skillDir = getSkillDir(paths, name, version);
  const skillFile = await readSkillFile(paths);
  const existing = skillFile.skills[name]?.versions[version];

  if (existing) {
    if (existing.integrity === scan.integrity) {
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
      await copyFile(path.join(sourceDir, file.relativePath), destination);
      await chmod(destination, file.mode).catch(() => undefined);
    }

    await mkdir(path.dirname(skillDir), { recursive: true });
    await rename(stagingDir, skillDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }

  try {
    await upsertSkillVersion(paths, {
      name,
      version,
      integrity: scan.integrity,
      fileCount: scan.fileCount,
      size: scan.totalSize,
    });
  } catch (error) {
    await rm(skillDir, { recursive: true, force: true });
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
