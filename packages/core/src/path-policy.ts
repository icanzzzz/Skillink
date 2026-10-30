import os from 'node:os';
import path from 'node:path';
import { SkillinkError, type SkillinkPaths } from '@skillink/shared';

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

function systemDirectories(): string[] {
  if (process.platform === 'win32') {
    return [
      process.env.SystemRoot,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.ProgramData,
    ].filter((value): value is string => Boolean(value));
  }

  return ['/etc', '/usr', '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys', '/var'];
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

  for (const systemDirectory of systemDirectories()) {
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
