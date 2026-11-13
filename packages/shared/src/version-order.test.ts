import { describe, expect, it } from 'vitest';
import {
  compareVersionDesc,
  highestVersion,
  preferredVersion,
  sortVersionsDesc,
  suggestNextVersion,
} from './version-order.js';

describe('version order', () => {
  it('sorts valid versions descending and pushes invalid ones last', () => {
    expect(
      sortVersionsDesc(['1.0.0', '1.10.0', '2.0.0-rc.1', '1.2.0', 'bogus']),
    ).toEqual(['2.0.0-rc.1', '1.10.0', '1.2.0', '1.0.0', 'bogus']);
  });

  it('does not mutate the input', () => {
    const input = ['1.0.0', '2.0.0'];
    sortVersionsDesc(input);
    expect(input).toEqual(['1.0.0', '2.0.0']);
  });

  it('returns null for an empty list', () => {
    expect(highestVersion([])).toBeNull();
    expect(highestVersion(['2.0.0', '1.0.0'])).toBe('2.0.0');
  });

  it('suggests the next patch of the highest version', () => {
    expect(suggestNextVersion([])).toBe('1.0.0');
    expect(suggestNextVersion(['1.0.0', '1.2.0'])).toBe('1.2.1');
    expect(suggestNextVersion(['not-a-version'])).toBe('1.0.0');
  });

  it('strips build metadata before bumping', () => {
    expect(suggestNextVersion(['1.2.0+abc'])).toBe('1.2.1');
  });

  it('prefers the highest stable version as the default', () => {
    expect(preferredVersion(['1.0.0', '1.1.0', '1.1.1-beta.1'])).toBe('1.1.0');
    expect(preferredVersion(['1.1.1-beta.1'])).toBe('1.1.1-beta.1');
    expect(preferredVersion([])).toBeNull();
    expect(preferredVersion(['1.2.0+abc', '1.3.0'])).toBe('1.3.0');
  });

  it('compares descending', () => {
    expect(compareVersionDesc('2.0.0', '1.0.0')).toBeLessThan(0);
    expect(compareVersionDesc('1.0.0', '2.0.0')).toBeGreaterThan(0);
    expect(compareVersionDesc('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersionDesc('1.0.0', 'bogus')).toBeLessThan(0);
  });
});
