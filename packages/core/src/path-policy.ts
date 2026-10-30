import { lstat, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SkillinkError,
  expandPath,
  type SkillinkPaths,
} from '@skillink/shared';

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isSamePath(left: string, right: string): boolean {
  return normalizeForCompare(left) === normalizeForCompare(right);
}

export function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(
    normalizeForCompare(parent),
    normalizeForCompare(child),
  );

  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function getSystemDirectories(): string[] {
  if (process.platform === 'win32') {
    return [
      process.env.SystemRoot,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.ProgramData,
    ].filter((value): value is string => Boolean(value));
  }

  return [
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/boot',
    '/dev',
    '/proc',
    '/sys',
    '/var',
    '/private/etc',
    '/private/var',
    '/System',
    '/Library',
  ];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function realPathWithMissing(target: string): Promise<string> {
  let current = path.resolve(target);
  const missing: string[] = [];

  for (;;) {
    try {
      const resolved = await realpath(current);
      return missing.length > 0
        ? path.join(resolved, ...missing.reverse())
        : resolved;
    } catch (error) {
      if (!(isNodeError(error) && error.code === 'ENOENT')) {
        throw error;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(target);
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

async function isInsideSystemDirectory(target: string): Promise<string | undefined> {
  for (const systemDirectory of getSystemDirectories()) {
    const realSystemDirectory = await realpath(systemDirectory).catch(
      () => systemDirectory,
    );
    if (
      isSamePath(target, systemDirectory) ||
      isPathInside(target, systemDirectory) ||
      isSamePath(target, realSystemDirectory) ||
      isPathInside(target, realSystemDirectory)
    ) {
      return systemDirectory;
    }
  }

  return undefined;
}

export interface ImportSourceOptions {
  systemDirectories?: string[];
}

export async function assertSafeImportSource(
  sourceDir: string,
  options: ImportSourceOptions = {},
): Promise<string> {
  const resolved = path.resolve(expandPath(sourceDir));
  const root = path.parse(resolved).root;

  if (isSamePath(resolved, root)) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      'Import source cannot be a filesystem root.',
      { sourceDir: resolved },
    );
  }

  const info = await lstat(resolved);
  if (info.isSymbolicLink()) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      `Import source cannot be a symbolic link: ${resolved}`,
      { sourceDir: resolved },
    );
  }

  if (!info.isDirectory()) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      `Import source is not a directory: ${resolved}`,
      { sourceDir: resolved },
    );
  }

  const realSource = await realPathWithMissing(resolved);
  const directories = options.systemDirectories ?? getSystemDirectories();
  for (const systemDirectory of directories) {
    const realSystemDirectory = await realpath(systemDirectory).catch(
      () => systemDirectory,
    );
    if (
      isSamePath(realSource, systemDirectory) ||
      isPathInside(realSource, systemDirectory) ||
      isSamePath(realSource, realSystemDirectory) ||
      isPathInside(realSource, realSystemDirectory)
    ) {
      throw new SkillinkError(
        'UNSAFE_PATH',
        `Import source cannot be a system directory: ${systemDirectory}`,
        { sourceDir: resolved, systemDirectory },
      );
    }
  }

  return resolved;
}

export async function assertSafeRealTargetPath(
  targetPath: string,
  paths: SkillinkPaths,
): Promise<string> {
  const resolved = assertSafeTargetPath(targetPath, paths);
  const realTarget = await realPathWithMissing(resolved);
  const realHome = await realPathWithMissing(paths.home);
  const realUserHome = await realPathWithMissing(os.homedir());
  const root = path.parse(realTarget).root;

  if (isSamePath(realTarget, root)) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      'Target path cannot be a filesystem root.',
      { targetPath: resolved },
    );
  }

  if (isSamePath(realTarget, realUserHome)) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      'Target path cannot be the user home directory.',
      { targetPath: resolved },
    );
  }

  if (
    isSamePath(realTarget, realHome) ||
    isPathInside(realTarget, realHome) ||
    isPathInside(realHome, realTarget)
  ) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      'Target path cannot resolve into or above the Skillink control plane.',
      { targetPath: resolved, controlPlane: paths.home, realTarget },
    );
  }

  const systemDirectory = await isInsideSystemDirectory(realTarget);
  if (systemDirectory) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      `Target path cannot resolve into a system directory: ${systemDirectory}`,
      { targetPath: resolved, systemDirectory },
    );
  }

  return resolved;
}

export function assertSafeTargetPath(
  targetPath: string,
  paths: SkillinkPaths,
): string {
  if (!path.isAbsolute(targetPath)) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      `Target path must be absolute: ${targetPath}`,
      { targetPath },
    );
  }

  const resolved = path.resolve(targetPath);
  const root = path.parse(resolved).root;

  if (isSamePath(resolved, root)) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      'Target path cannot be a filesystem root.',
      { targetPath: resolved },
    );
  }

  if (isSamePath(resolved, os.homedir())) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      'Target path cannot be the user home directory.',
      { targetPath: resolved },
    );
  }

  if (isSamePath(resolved, paths.home) || isPathInside(resolved, paths.home)) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      'Target path cannot be inside the Skillink control plane.',
      { targetPath: resolved, controlPlane: paths.home },
    );
  }

  if (isPathInside(paths.home, resolved)) {
    throw new SkillinkError(
      'UNSAFE_PATH',
      'Target path cannot be an ancestor of the Skillink control plane.',
      { targetPath: resolved, controlPlane: paths.home },
    );
  }

  for (const systemDirectory of getSystemDirectories()) {
    if (
      isSamePath(resolved, systemDirectory) ||
      isPathInside(resolved, systemDirectory)
    ) {
      throw new SkillinkError(
        'UNSAFE_PATH',
        `Target path cannot be a system directory: ${systemDirectory}`,
        { targetPath: resolved, systemDirectory },
      );
    }
  }

  return resolved;
}
