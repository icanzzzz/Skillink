import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { SkillinkError, type SkillVersion } from '@skillink/shared';
import { DEFAULT_IMPORT_LIMITS, scanFolder } from './folder-scan.js';
import { withFsRetry } from './fs-retry.js';

export interface CopySkillDirectoryContext {
  targetId?: string;
  targetPath?: string;
  skill?: string;
  version?: string;
}

function copyError(
  message: string,
  details: Record<string, unknown>,
  cause: unknown,
): SkillinkError {
  return new SkillinkError('IO_ERROR', message, details, { cause });
}

function sortedByDepth<T extends { relativePath: string }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => {
    const depth = right.relativePath.split('/').length -
      left.relativePath.split('/').length;
    return depth !== 0
      ? depth
      : right.relativePath.localeCompare(left.relativePath);
  });
}

/**
 * Copy a skill library directory into a fresh destination and verify that the
 * copied manifest matches the expected skill version.
 *
 * The caller owns the destination path. On any failure the destination is
 * removed before the error is rethrown.
 */
export async function copySkillDirectory(
  sourceDir: string,
  destination: string,
  expected: SkillVersion,
  context: CopySkillDirectoryContext = {},
): Promise<void> {
  const details = {
    ...context,
    sourceDir,
    destination,
  };
  const scan = await scanFolder(sourceDir, DEFAULT_IMPORT_LIMITS);

  if (scan.kind !== 'skill') {
    throw new SkillinkError(
      'SKILL_MD_MISSING',
      `Skill source has no SKILL.md: ${sourceDir}`,
      details,
    );
  }

  try {
    for (const directory of scan.directories) {
      await withFsRetry(() =>
        mkdir(path.join(destination, directory.relativePath), {
          recursive: true,
        }),
      );
    }

    for (const file of scan.files) {
      const filePath = path.join(destination, file.relativePath);
      await withFsRetry(() => mkdir(path.dirname(filePath), { recursive: true }));
      await withFsRetry(() =>
        copyFile(path.join(sourceDir, file.relativePath), filePath),
      );
      await withFsRetry(() => chmod(filePath, file.mode));
    }

    for (const directory of sortedByDepth(scan.directories)) {
      await withFsRetry(() =>
        chmod(path.join(destination, directory.relativePath), directory.mode),
      );
    }

    const copied = await scanFolder(destination, DEFAULT_IMPORT_LIMITS);
    if (copied.kind !== 'skill') {
      throw new SkillinkError(
        'SKILL_MD_MISSING',
        `Copied skill has no SKILL.md: ${destination}`,
        details,
      );
    }

    if (
      copied.integrity !== expected.integrity ||
      copied.fileCount !== expected.fileCount ||
      copied.totalSize !== expected.size
    ) {
      throw new SkillinkError(
        'SKILL_INTEGRITY_MISMATCH',
        `Copied content does not match the expected skill: ${sourceDir}`,
        {
          ...details,
          expected: expected.integrity,
          actual: copied.integrity,
          expectedFileCount: expected.fileCount,
          actualFileCount: copied.fileCount,
          expectedSize: expected.size,
          actualSize: copied.totalSize,
        },
      );
    }
  } catch (error) {
    try {
      await withFsRetry(() =>
        rm(destination, { recursive: true, force: true }),
      );
    } catch (cleanupError) {
      throw copyError(
        `Failed to clean up the copied skill at ${destination}.`,
        {
          ...details,
          originalError:
            error instanceof Error ? error.message : String(error),
        },
        cleanupError,
      );
    }

    if (error instanceof SkillinkError) {
      throw error;
    }

    throw copyError(
      `Failed to copy skill content from ${sourceDir} to ${destination}.`,
      details,
      error,
    );
  }
}
