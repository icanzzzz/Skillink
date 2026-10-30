import semver from 'semver';
import { SkillinkError } from '@skillink/shared';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_WINDOWS_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_OBJECT_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

export type NameCollisionKind = 'package' | 'skill' | 'target';

function caseFold(value: string): string {
  return value.toLocaleLowerCase('en-US');
}

export function findCaseInsensitiveCollision(
  existing: Iterable<string>,
  candidate: string,
): string | undefined {
  const folded = caseFold(candidate);
  for (const name of existing) {
    if (name !== candidate && caseFold(name) === folded) {
      return name;
    }
  }
  return undefined;
}

export function findCaseInsensitiveDuplicates(
  names: Iterable<string>,
): Array<[string, string]> {
  const seen = new Map<string, string>();
  const duplicates: Array<[string, string]> = [];

  for (const name of names) {
    const folded = caseFold(name);
    const existing = seen.get(folded);
    if (existing !== undefined && existing !== name) {
      duplicates.push([existing, name]);
    } else {
      seen.set(folded, name);
    }
  }

  return duplicates;
}

export function assertNoCaseInsensitiveCollision(
  existing: Iterable<string>,
  candidate: string,
  kind: NameCollisionKind,
): void {
  const collision = findCaseInsensitiveCollision(existing, candidate);
  if (!collision) {
    return;
  }

  throw new SkillinkError(
    kind === 'target' ? 'TARGET_EXISTS' : 'PACKAGE_EXISTS',
    `A ${kind} named "${collision}" already exists; ${kind} names are case-insensitive.`,
    { candidate, existing: collision, kind },
  );
}

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

  if (RESERVED_OBJECT_NAMES.has(name.toLowerCase())) {
    throw new SkillinkError(
      'INVALID_NAME',
      `Package name "${name}" is reserved for object safety.`,
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
