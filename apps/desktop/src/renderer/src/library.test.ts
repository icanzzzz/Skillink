import { describe, expect, it } from 'vitest';
import type {
  PackageFile,
  SkillFile,
  SkillVersion,
} from '@skillink/shared';
import {
  defaultRequested,
  packageOptions,
  skillOptions,
  suggestVersionFor,
  versionChoices,
  type LibraryOption,
  type PackageOption,
} from './library.js';

function version(): SkillVersion {
  return { integrity: 'sha512-test', fileCount: 1, size: 10, built: false };
}

const skills: SkillFile = {
  schemaVersion: 2,
  skills: {
    b: { versions: { '1.0.0': version(), '1.10.0': version() } },
    a: { versions: { '2.0.0': version() } },
  },
};

const packages: PackageFile = {
  schemaVersion: 2,
  packages: {
    frontend: {
      versions: {
        '1.0.0': { skills: { a: '1.0.0' }, packages: {} },
        '1.2.0': { skills: { a: '1.0.0', b: '1.0.0' }, packages: {} },
      },
    },
    backend: {
      versions: {
        '0.1.0': { skills: { a: '1.0.0' }, packages: {} },
      },
    },
  },
};

describe('library options', () => {
  it('lists skill options sorted by name with descending versions', () => {
    const options = skillOptions(skills);

    expect(options.map((option) => option.name)).toEqual(['a', 'b']);
    expect(options[1]?.versions).toEqual(['1.10.0', '1.0.0']);
    expect(options[0]?.latestVersion).toBe('2.0.0');
    expect(defaultRequested(options[0]!)).toBe('2.0.0');
  });

  it('lists package options sorted by name', () => {
    expect(packageOptions(packages).map((option) => option.name)).toEqual([
      'backend',
      'frontend',
    ]);
  });

  it('prefers the latest tag when it points at an existing version', () => {
    const source: SkillFile = {
      schemaVersion: 2,
      skills: {
        tagged: {
          tags: { latest: '1.0.0' },
          versions: { '1.0.0': version(), '2.0.0': version() },
        },
      },
    };

    expect(skillOptions(source)[0]?.latestVersion).toBe('1.0.0');
  });

  it('ignores a latest tag pointing at a missing version', () => {
    const source: SkillFile = {
      schemaVersion: 2,
      skills: {
        tagged: {
          tags: { latest: '9.9.9' },
          versions: { '1.0.0': version(), '2.0.0': version() },
        },
      },
    };

    expect(skillOptions(source)[0]?.latestVersion).toBe('2.0.0');
  });

  it('builds version choices with tags first when enabled', () => {
    const option: LibraryOption = {
      name: 'frontend',
      tags: { latest: '1.0.0', stable: '2.0.0', broken: '9.9.9' },
      versions: ['2.0.0', '1.0.0'],
      latestVersion: '1.0.0',
    };

    const withTags = versionChoices(option, true);
    expect(withTags[0]).toEqual({
      value: 'latest',
      label: 'latest → 1.0.0',
      kind: 'tag',
    });
    expect(withTags.map((choice) => choice.value)).toEqual([
      'latest',
      'stable',
      '2.0.0',
      '1.0.0',
    ]);
    expect(
      withTags.filter((choice) => choice.kind === 'tag').map((choice) => choice.value),
    ).not.toContain('broken');

    const versionsOnly = versionChoices(option, false);
    expect(versionsOnly.some((choice) => choice.kind === 'tag')).toBe(false);
    expect(versionsOnly.map((choice) => choice.value)).toEqual(['2.0.0', '1.0.0']);
  });

  it('counts direct skills per package version', () => {
    const option = packageOptions(packages)[1] as PackageOption;

    expect(option.skillCount['1.2.0']).toBe(2);
    expect(option.skillCount['1.0.0']).toBe(1);
  });

  it('suggests a next version per package', () => {
    expect(suggestVersionFor(packages, 'frontend')).toBe('1.2.1');
    expect(suggestVersionFor(packages, 'missing')).toBe('1.0.0');
  });
});
