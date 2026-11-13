import { inc, parse, rcompare, valid } from 'semver';

function isValidVersion(value: string): boolean {
  return valid(value) !== null;
}

export function compareVersionDesc(left: string, right: string): number {
  const leftValid = isValidVersion(left);
  const rightValid = isValidVersion(right);
  if (leftValid && rightValid) {
    return rcompare(left, right);
  }
  if (leftValid) {
    return -1;
  }
  if (rightValid) {
    return 1;
  }
  return right.localeCompare(left);
}

export function sortVersionsDesc(versions: readonly string[]): string[] {
  return [...versions].sort(compareVersionDesc);
}

export function highestVersion(versions: readonly string[]): string | null {
  return sortVersionsDesc(versions)[0] ?? null;
}

/**
 * The version a view should select first: the highest stable release, falling
 * back to the highest version when only prereleases are published. Betas stay
 * selectable, they just do not pre-empt a stable release as the default.
 */
export function preferredVersion(versions: readonly string[]): string | null {
  const ordered = sortVersionsDesc(versions);
  const stable = ordered.find((version) => {
    const parsed = parse(version);
    return parsed !== null && parsed.prerelease.length === 0;
  });
  return stable ?? ordered[0] ?? null;
}

export function suggestNextVersion(versions: readonly string[]): string {
  const highest = highestVersion(versions.filter(isValidVersion));
  if (highest === null) {
    return '1.0.0';
  }

  const parsed = parse(highest);
  if (parsed === null) {
    return '1.0.0';
  }

  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return inc(core, 'patch') ?? '1.0.0';
}
