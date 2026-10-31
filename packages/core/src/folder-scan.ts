import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { SkillinkError } from '@skillink/shared';

export type FolderKind = 'skill' | 'folder';

export interface ScannedFile {
  relativePath: string;
  mode: number;
  size: number;
  integrity: string;
}

export interface ScannedDirectory {
  relativePath: string;
  mode: number;
}

export interface FolderScan {
  files: ScannedFile[];
  directories: ScannedDirectory[];
  fileCount: number;
  totalSize: number;
  manifestHash: string;
  integrity: string;
  kind: FolderKind;
}

export interface ScanFolderOptions {
  maxFiles?: number;
  maxBytes?: number;
  maxDepth?: number;
}

export const DEFAULT_IMPORT_LIMITS: Required<ScanFolderOptions> = {
  maxFiles: 10_000,
  maxBytes: 512 * 1024 * 1024,
  maxDepth: 64,
};

async function hashFile(filePath: string): Promise<Buffer> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest();
}

function toPosixRelative(root: string, fullPath: string): string {
  return path.relative(root, fullPath).split(path.sep).join('/');
}

export async function scanFolder(
  root: string,
  options: ScanFolderOptions = {},
): Promise<FolderScan> {
  const files: ScannedFile[] = [];
  const directories: ScannedDirectory[] = [];
  let totalBytes = 0;
  let hasSkillMd = false;

  async function walk(current: string, depth: number): Promise<void> {
    if (options.maxDepth !== undefined && depth > options.maxDepth) {
      throw new SkillinkError(
        'IMPORT_LIMIT_EXCEEDED',
        `Source folder exceeds the maximum depth of ${options.maxDepth}.`,
        { path: current, depth, maxDepth: options.maxDepth },
      );
    }

    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = toPosixRelative(root, fullPath);
      const info = await lstat(fullPath);

      if (entry.isSymbolicLink() || info.isSymbolicLink()) {
        throw new SkillinkError(
          'UNSAFE_PATH',
          `Source folder contains a directory link (symbolic link or junction): ${fullPath}`,
          { path: fullPath, relativePath },
        );
      }

      if (info.isDirectory()) {
        directories.push({ relativePath, mode: info.mode & 0o777 });
        await walk(fullPath, depth + 1);
        continue;
      }

      if (info.isFile()) {
        if (
          options.maxFiles !== undefined &&
          files.length + 1 > options.maxFiles
        ) {
          throw new SkillinkError(
            'IMPORT_LIMIT_EXCEEDED',
            `Source folder exceeds the maximum file count of ${options.maxFiles}.`,
            {
              path: fullPath,
              fileCount: files.length + 1,
              maxFiles: options.maxFiles,
            },
          );
        }

        if (
          options.maxBytes !== undefined &&
          totalBytes + info.size > options.maxBytes
        ) {
          throw new SkillinkError(
            'IMPORT_LIMIT_EXCEEDED',
            `Source folder exceeds the maximum size of ${options.maxBytes} bytes.`,
            {
              path: fullPath,
              totalBytes: totalBytes + info.size,
              maxBytes: options.maxBytes,
            },
          );
        }

        const digest = await hashFile(fullPath);
        totalBytes += info.size;
        files.push({
          relativePath,
          mode: info.mode & 0o777,
          size: info.size,
          integrity: `sha512-${digest.toString('base64')}`,
        });
        if (relativePath === 'SKILL.md') {
          hasSkillMd = true;
        }
        continue;
      }

      throw new SkillinkError(
        'UNSAFE_PATH',
        `Source folder contains an unsupported entry: ${relativePath}`,
        { relativePath },
      );
    }
  }

  await walk(root, 0);

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  directories.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  const manifestEntries = [
    ...directories.map((directory) => ({
      type: 'directory',
      path: directory.relativePath,
      mode: directory.mode,
    })),
    ...files.map((file) => ({
      type: 'file',
      path: file.relativePath,
      mode: file.mode,
      size: file.size,
      integrity: file.integrity,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));

  const manifestDigest = createHash('sha512')
    .update(JSON.stringify(manifestEntries))
    .digest();

  return {
    files,
    directories,
    fileCount: files.length,
    totalSize: files.reduce((total, file) => total + file.size, 0),
    manifestHash: manifestDigest.toString('hex'),
    integrity: `sha512-${manifestDigest.toString('base64')}`,
    kind: hasSkillMd ? 'skill' : 'folder',
  };
}
