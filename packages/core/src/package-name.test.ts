import { describe, expect, it } from 'vitest';
import { assertSafePackageName, normalizeVersion } from './package-name.js';

describe('package names', () => {
  it.each(['demo', 'my-package', '我的包', 'a b'])('accepts %s', (name) => {
    expect(assertSafePackageName(name)).toBe(name);
  });

  it.each(['', '.', '..', 'a/b', 'a\\b', 'CON', 'name.', 'name ', 'a:b'])(
    'rejects %s',
    (name) => {
      expect(() => assertSafePackageName(name)).toThrow();
    },
  );
});

describe('versions', () => {
  it('accepts semver', () => {
    expect(normalizeVersion('1.2.3')).toBe('1.2.3');
  });

  it('accepts auto versions with build metadata', () => {
    expect(normalizeVersion('0.0.0+abc12345')).toBe('0.0.0+abc12345');
  });

  it('returns undefined for an empty version', () => {
    expect(normalizeVersion(undefined)).toBeUndefined();
    expect(normalizeVersion('   ')).toBeUndefined();
  });

  it('rejects an invalid version', () => {
    expect(() => normalizeVersion('not-a-version')).toThrow();
  });
});
