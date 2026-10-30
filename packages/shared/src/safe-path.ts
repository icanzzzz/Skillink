import { SkillinkError } from './errors.js';

const INVALID_SEGMENT_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const SAFE_VERSION_START = /^[0-9A-Za-z]/;

export function isSafeSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    value !== '.' &&
    value !== '..' &&
    value === value.trim() &&
    !INVALID_SEGMENT_CHARS.test(value) &&
    !/[. ]$/.test(value) &&
    !WINDOWS_RESERVED.test(value)
  );
}

export function isSafeVersion(value: string): boolean {
  return isSafeSegment(value) && SAFE_VERSION_START.test(value);
}

export function assertSafeSegment(
  value: string,
  label = 'path segment',
): string {
  if (!isSafeSegment(value)) {
    throw new SkillinkError('UNSAFE_PATH', `Unsafe ${label}: ${value}`, {
      value,
      label,
    });
  }

  return value;
}

export function assertSafeVersion(value: string, label = 'version'): string {
  if (!isSafeVersion(value)) {
    throw new SkillinkError('UNSAFE_PATH', `Unsafe ${label}: ${value}`, {
      value,
      label,
    });
  }

  return value;
}
