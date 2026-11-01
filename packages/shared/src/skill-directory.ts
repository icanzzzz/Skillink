import semver from 'semver';
import { isSafeSegment } from './safe-path.js';

export interface SkillDirectoryName {
  name?: string;
  version?: string;
}

function lastPathSegment(value: string): string {
  const segments = value.trim().split(/[\\/]+/u).filter(Boolean);
  return segments.at(-1) ?? '';
}

function isSemver(value: string): boolean {
  return isSafeSegment(value) && semver.valid(value) !== null;
}

export function parseSkillDirectoryName(
  value: string,
): SkillDirectoryName | undefined {
  const folderName = lastPathSegment(value);
  if (folderName === '') {
    return undefined;
  }

  const separator = folderName.lastIndexOf('@');
  if (separator === -1) {
    return isSafeSegment(folderName) ? { name: folderName } : undefined;
  }

  const rawName = folderName.slice(0, separator);
  const rawVersion = folderName.slice(separator + 1);
  const name = isSafeSegment(rawName) ? rawName : undefined;
  const version = isSemver(rawVersion) ? rawVersion : undefined;

  if (name === undefined && version === undefined) {
    return undefined;
  }

  return {
    ...(name === undefined ? {} : { name }),
    ...(version === undefined ? {} : { version }),
  };
}
