import { describe, expect, it } from 'vitest';
import type {
  PackageFile,
  PackageVersion,
  SkillFile,
  SkillVersion,
} from '@skillink/shared';
import {
  collectPackageSkillRefs,
  computePackageIntegrity,
  resolvePackageGraph,
  validateAllPackages,
} from './package-graph.js';

function skillVersion(integrity = 'sha512-default'): SkillVersion {
  return {
    integrity,
    fileCount: 1,
    size: 1,
    built: false,
  };
}

function skills(
  entries: Record<string, Record<string, SkillVersion>>,
): SkillFile {
  return {
    schemaVersion: 2,
    skills: Object.fromEntries(
      Object.entries(entries).map(([name, versions]) => [
        name,
        { versions },
      ]),
    ),
  };
}

function packageVersion(input: {
  packages?: Record<string, string>;
  skills?: Record<string, string>;
}): PackageVersion {
  return {
    packages: input.packages ?? {},
    skills: input.skills ?? {},
  };
}

function packages(
  entries: Record<string, Record<string, PackageVersion>>,
): PackageFile {
  return {
    schemaVersion: 2,
    packages: Object.fromEntries(
      Object.entries(entries).map(([name, versions]) => [
        name,
        { versions },
      ]),
    ),
  };
}

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe('resolvePackageGraph', () => {
  it('resolves a single package with one skill', () => {
    const file = packages({
      frontend: {
        '1.0.0': packageVersion({ skills: { pdf: '1.0.0' } }),
      },
    });
    const catalog = skills({ pdf: { '1.0.0': skillVersion() } });

    const resolution = resolvePackageGraph(file, catalog, [
      { name: 'frontend', version: '1.0.0' },
    ]);

    expect(resolution.packages.get('frontend@1.0.0')).toMatchObject({
      name: 'frontend',
      version: '1.0.0',
    });
    expect(resolution.skills.get('pdf')).toMatchObject({
      name: 'pdf',
      version: '1.0.0',
      requiredBy: ['frontend@1.0.0'],
    });
  });

  it('resolves skills through nested packages', () => {
    const file = packages({
      frontend: {
        '1.0.0': packageVersion({
          packages: { base: '2.0.0' },
          skills: { pdf: '1.0.0' },
        }),
      },
      base: {
        '2.0.0': packageVersion({ skills: { review: '1.0.0' } }),
      },
    });
    const catalog = skills({
      pdf: { '1.0.0': skillVersion() },
      review: { '1.0.0': skillVersion() },
    });

    const resolution = resolvePackageGraph(file, catalog, [
      { name: 'frontend', version: '1.0.0' },
    ]);

    expect([...resolution.packages.keys()].sort()).toEqual([
      'base@2.0.0',
      'frontend@1.0.0',
    ]);
    expect([...resolution.skills.keys()].sort()).toEqual(['pdf', 'review']);
  });

  it('deduplicates the same skill version required by multiple packages', () => {
    const file = packages({
      a: {
        '1.0.0': packageVersion({ skills: { pdf: '1.0.0' } }),
      },
      b: {
        '1.0.0': packageVersion({ skills: { pdf: '1.0.0' } }),
      },
    });
    const catalog = skills({ pdf: { '1.0.0': skillVersion() } });

    const resolution = resolvePackageGraph(file, catalog, [
      { name: 'a', version: '1.0.0' },
      { name: 'b', version: '1.0.0' },
    ]);

    expect(resolution.skills.size).toBe(1);
    expect(resolution.skills.get('pdf')?.requiredBy).toEqual([
      'a@1.0.0',
      'b@1.0.0',
    ]);
  });

  it('rejects the same skill at different versions', () => {
    const file = packages({
      a: {
        '1.0.0': packageVersion({ skills: { pdf: '1.0.0' } }),
      },
      b: {
        '1.0.0': packageVersion({ skills: { pdf: '2.0.0' } }),
      },
    });
    const catalog = skills({
      pdf: {
        '1.0.0': skillVersion(),
        '2.0.0': skillVersion(),
      },
    });

    expect(() =>
      resolvePackageGraph(file, catalog, [
        { name: 'a', version: '1.0.0' },
        { name: 'b', version: '1.0.0' },
      ]),
    ).toThrowError(/pdf.*1\.0\.0.*2\.0\.0/i);
    expect(
      errorCode(() =>
        resolvePackageGraph(file, catalog, [
          { name: 'a', version: '1.0.0' },
          { name: 'b', version: '1.0.0' },
        ]),
      ),
    ).toBe('SKILL_VERSION_CONFLICT');
  });

  it('rejects a self-cycle', () => {
    const file = packages({
      a: {
        '1.0.0': packageVersion({ packages: { a: '1.0.0' } }),
      },
    });

    expect(
      errorCode(() =>
        resolvePackageGraph(file, skills({}), [
          { name: 'a', version: '1.0.0' },
        ]),
      ),
    ).toBe('PACKAGE_CYCLE');
    expect(() =>
      resolvePackageGraph(file, skills({}), [
        { name: 'a', version: '1.0.0' },
      ]),
    ).toThrowError(/a@1\.0\.0 -> a@1\.0\.0/);
  });

  it('rejects a two-node cycle', () => {
    const file = packages({
      a: {
        '1.0.0': packageVersion({ packages: { b: '1.0.0' } }),
      },
      b: {
        '1.0.0': packageVersion({ packages: { a: '1.0.0' } }),
      },
    });

    expect(
      errorCode(() =>
        resolvePackageGraph(file, skills({}), [
          { name: 'a', version: '1.0.0' },
        ]),
      ),
    ).toBe('PACKAGE_CYCLE');
    expect(() =>
      resolvePackageGraph(file, skills({}), [
        { name: 'a', version: '1.0.0' },
      ]),
    ).toThrowError(/a@1\.0\.0 -> b@1\.0\.0 -> a@1\.0\.0/);
  });

  it('rejects a three-node cycle', () => {
    const file = packages({
      a: {
        '1.0.0': packageVersion({ packages: { b: '1.0.0' } }),
      },
      b: {
        '1.0.0': packageVersion({ packages: { c: '1.0.0' } }),
      },
      c: {
        '1.0.0': packageVersion({ packages: { a: '1.0.0' } }),
      },
    });

    expect(
      errorCode(() =>
        resolvePackageGraph(file, skills({}), [
          { name: 'a', version: '1.0.0' },
        ]),
      ),
    ).toBe('PACKAGE_CYCLE');
    expect(() =>
      resolvePackageGraph(file, skills({}), [
        { name: 'a', version: '1.0.0' },
      ]),
    ).toThrowError(/a@1\.0\.0 -> b@1\.0\.0 -> c@1\.0\.0 -> a@1\.0\.0/);
  });

  it('rejects a cycle through different versions of the same package', () => {
    const file = packages({
      a: {
        '1.0.0': packageVersion({ packages: { a: '2.0.0' } }),
        '2.0.0': packageVersion({ packages: { a: '1.0.0' } }),
      },
    });

    expect(
      errorCode(() =>
        resolvePackageGraph(file, skills({}), [
          { name: 'a', version: '1.0.0' },
        ]),
      ),
    ).toBe('PACKAGE_CYCLE');
    expect(() =>
      resolvePackageGraph(file, skills({}), [
        { name: 'a', version: '1.0.0' },
      ]),
    ).toThrowError(/a@1\.0\.0 -> a@2\.0\.0 -> a@1\.0\.0/);
  });

  it('allows the same package name at different versions without a cycle', () => {
    const file = packages({
      frontend: {
        '1.0.0': packageVersion({ packages: { base: '1.0.0' } }),
        '2.0.0': packageVersion({ packages: { base: '2.0.0' } }),
      },
      base: {
        '1.0.0': packageVersion({ skills: { pdf: '1.0.0' } }),
        '2.0.0': packageVersion({ skills: { review: '1.0.0' } }),
      },
    });
    const catalog = skills({
      pdf: { '1.0.0': skillVersion() },
      review: { '1.0.0': skillVersion() },
    });

    const resolution = resolvePackageGraph(file, catalog, [
      { name: 'frontend', version: '1.0.0' },
      { name: 'frontend', version: '2.0.0' },
    ]);

    expect([...resolution.packages.keys()].sort()).toEqual([
      'base@1.0.0',
      'base@2.0.0',
      'frontend@1.0.0',
      'frontend@2.0.0',
    ]);
    expect([...resolution.skills.keys()].sort()).toEqual(['pdf', 'review']);
  });

  it('rejects a missing package, version, or skill', () => {
    const file = packages({
      a: {
        '1.0.0': packageVersion({ skills: { pdf: '1.0.0' } }),
        '2.0.0': packageVersion({ packages: { missing: '1.0.0' } }),
      },
    });
    const missingSkill = packages({
      a: {
        '1.0.0': packageVersion({ skills: { ghost: '1.0.0' } }),
      },
    });
    const catalog = skills({ pdf: { '1.0.0': skillVersion() } });

    expect(
      errorCode(() =>
        resolvePackageGraph(file, catalog, [
          { name: 'nope', version: '1.0.0' },
        ]),
      ),
    ).toBe('PACKAGE_NOT_FOUND');
    expect(
      errorCode(() =>
        resolvePackageGraph(file, catalog, [
          { name: 'a', version: '9.9.9' },
        ]),
      ),
    ).toBe('VERSION_NOT_FOUND');
    expect(
      errorCode(() =>
        resolvePackageGraph(file, catalog, [
          { name: 'a', version: '2.0.0' },
        ]),
      ),
    ).toBe('PACKAGE_NOT_FOUND');
    expect(
      errorCode(() =>
        resolvePackageGraph(missingSkill, catalog, [
          { name: 'a', version: '1.0.0' },
        ]),
      ),
    ).toBe('VERSION_NOT_FOUND');
  });
});

describe('computePackageIntegrity', () => {
  it('is stable across key order and changes with the transitive closure', () => {
    const first = packages({
      frontend: {
        '1.0.0': packageVersion({
          packages: { base: '1.0.0' },
          skills: { pdf: '1.0.0' },
        }),
        '2.0.0': packageVersion({
          packages: { base: '1.0.0' },
          skills: { pdf: '2.0.0' },
        }),
      },
      base: {
        '1.0.0': packageVersion({ skills: { review: '1.0.0' } }),
      },
    });
    const second = packages({
      base: {
        '1.0.0': packageVersion({ skills: { review: '1.0.0' } }),
      },
      frontend: {
        '1.0.0': packageVersion({
          skills: { pdf: '1.0.0' },
          packages: { base: '1.0.0' },
        }),
        '2.0.0': packageVersion({
          skills: { pdf: '2.0.0' },
          packages: { base: '1.0.0' },
        }),
      },
    });
    const changedNested = packages({
      frontend: {
        '1.0.0': packageVersion({
          packages: { base: '1.0.0' },
          skills: { pdf: '1.0.0' },
        }),
      },
      base: {
        '1.0.0': packageVersion({ skills: { review: '2.0.0' } }),
      },
    });

    const root = [{ name: 'frontend', version: '1.0.0' }];
    const integrity = computePackageIntegrity(first, root);
    const secondIntegrity = computePackageIntegrity(second, root);

    expect(integrity).toMatch(/^sha256-/);
    expect(secondIntegrity).toBe(integrity);
    expect(computePackageIntegrity(changedNested, root)).not.toBe(integrity);
    expect(
      computePackageIntegrity(first, [{ name: 'frontend', version: '2.0.0' }]),
    ).not.toBe(integrity);
  });
});

describe('validateAllPackages', () => {
  it('finds a cycle in any package version', () => {
    const file = packages({
      healthy: {
        '1.0.0': packageVersion({ skills: { pdf: '1.0.0' } }),
      },
      a: {
        '1.0.0': packageVersion({ packages: { b: '1.0.0' } }),
      },
      b: {
        '1.0.0': packageVersion({ packages: { a: '1.0.0' } }),
      },
    });
    const catalog = skills({ pdf: { '1.0.0': skillVersion() } });

    expect(() => validateAllPackages(file, catalog)).toThrowError(
      /a@1\.0\.0 -> b@1\.0\.0 -> a@1\.0\.0/,
    );
  });

  it('accepts a fully valid package file', () => {
    const file = packages({
      a: {
        '1.0.0': packageVersion({ skills: { pdf: '1.0.0' } }),
      },
    });
    const catalog = skills({ pdf: { '1.0.0': skillVersion() } });

    expect(() => validateAllPackages(file, catalog)).not.toThrow();
  });
});

describe('collectPackageSkillRefs', () => {
  it('collects skill refs through nested packages without needing skill.json', () => {
    const file = packages({
      frontend: {
        '1.0.0': packageVersion({
          packages: { base: '2.0.0' },
          skills: { pdf: '1.0.0' },
        }),
      },
      base: {
        '2.0.0': packageVersion({ skills: { review: '1.0.0' } }),
      },
    });

    expect(
      collectPackageSkillRefs(file, [
        { name: 'frontend', version: '1.0.0' },
      ]),
    ).toEqual(new Set(['pdf@1.0.0', 'review@1.0.0']));
  });

  it('rejects cycles while collecting skill refs', () => {
    const file = packages({
      a: {
        '1.0.0': packageVersion({ packages: { b: '1.0.0' } }),
      },
      b: {
        '1.0.0': packageVersion({ packages: { a: '1.0.0' } }),
      },
    });

    expect(() =>
      collectPackageSkillRefs(file, [{ name: 'a', version: '1.0.0' }]),
    ).toThrowError(/a@1\.0\.0 -> b@1\.0\.0 -> a@1\.0\.0/);
  });
});
