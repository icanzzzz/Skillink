import semver from 'semver';
import { SkillinkError } from '@skillink/shared';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_WINDOWS_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

export function assertSafePackageName(name: string): string {
  if (!name || name !== name.trim()) {
    throw new SkillinkError(
      'INVALID_NAME',
      'Package name must be non-empty and have no leading/trailing whitespace.',
      { name },
    );
  }

  if (name === '.' || name === '..') {
    throw new SkillinkError('INVALID_NAME', 'Package name cannot be "." or "..".', {
      name,
    });
  }

  if (name.length > 128) {
    throw new SkillinkError(
      'INVALID_NAME',
      'Package name must be 128 characters or fewer.',
      { name },
    );
  }

  if (INVALID_WINDOWS_CHARS.test(name)) {
    throw new SkillinkError(
      'INVALID_NAME',
      'Package name contains characters that are invalid on Windows.',
      { name },
    );
  }

  if (/[. ]$/.test(name)) {
    throw new SkillinkError(
      'INVALID_NAME',
      'Package name cannot end with a dot or space.',
      { name },
    );
  }

  if (WINDOWS_RESERVED.test(name)) {
    throw new SkillinkError(
      'INVALID_NAME',
      `Package name "${name}" is reserved on Windows.`,
      { name },
    );
  }

  return name;
}

export function normalizeVersion(version?: string): string | undefined {
  if (version === undefined || version.trim() === '') {
    return undefined;
  }

  const normalized = version.trim();
  if (!semver.valid(normalized)) {
    throw new SkillinkError(
      'INVALID_VERSION',
      `Version must be valid semver: ${version}`,
      { version },
    );
  }

  return normalized;
}

export function createAutoVersion(hash: string): string {
  return `0.0.0+${hash.slice(0, 8)}`;
}
