import { lstat, readlink, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { SkillinkError, type SkillinkPaths } from '@skillink/shared';
import { withFsRetry } from './fs-retry.js';
import { isPathInside, isSamePath } from './path-policy.js';
import { isNodeError } from './node-error.js';

export type PathInspection =
  | { kind: 'missing' }
  | { kind: 'link'; target: string }
  | { kind: 'directory' }
  | { kind: 'file' }
  | { kind: 'other' };

export async function resolveLinkTarget(linkPath: string): Promise<string> {
  const raw = await readlink(linkPath);
  return path.resolve(path.dirname(linkPath), raw);
}

export async function inspectPath(targetPath: string): Promise<PathInspection> {
  try {
    const info = await lstat(targetPath);
    if (info.isSymbolicLink()) {
      return { kind: 'link', target: await resolveLinkTarget(targetPath) };
    }
    if (info.isDirectory()) {
      return { kind: 'directory' };
    }
    if (info.isFile()) {
      return { kind: 'file' };
    }
    return { kind: 'other' };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { kind: 'missing' };
    }
    throw error;
  }
}

export async function isManagedLink(
  linkPath: string,
  paths: SkillinkPaths,
): Promise<boolean> {
  try {
    const target = await resolveLinkTarget(linkPath);
    return isSamePath(target, paths.libraryDir) || isPathInside(target, paths.libraryDir);
  } catch {
    return false;
  }
}

export async function createDirectoryLink(
  sourceDir: string,
  destination: string,
): Promise<void> {
  const type = process.platform === 'win32' ? 'junction' : 'dir';

  try {
    await withFsRetry(() => symlink(sourceDir, destination, type));
  } catch (error) {
    throw new SkillinkError(
      'LINK_FAILED',
      `Failed to create a directory link from ${destination} to ${sourceDir}.`,
      { sourceDir, destination, linkType: type },
      { cause: error },
    );
  }
}

export async function removeLink(linkPath: string): Promise<void> {
  try {
    await withFsRetry(() => unlink(linkPath));
  } catch (error) {
    throw new SkillinkError(
      'LINK_FAILED',
      `Failed to remove link ${linkPath}.`,
      { linkPath },
      { cause: error },
    );
  }
}
