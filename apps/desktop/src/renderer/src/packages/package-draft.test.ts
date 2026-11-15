import { describe, expect, it } from 'vitest';
import type { PackageFile, SkillFile } from '@skillink/shared';
import { packageOptions, skillOptions } from '../library.js';
import {
  copyPackageDraft,
  createPackageDraft,
  packageDraftIssues,
  setDraftDescription,
  setDraftName,
  setDraftNameMode,
  setDraftPackageVersion,
  setDraftSkillVersion,
  setDraftVersion,
  toCreatePackageInput,
  toggleDraftPackage,
  toggleDraftSkill,
  type PackageDraft,
} from './package-draft.js';

const packages: PackageFile = {
  schemaVersion: 2,
  packages: {
    base: {
      versions: {
        '2.0.0': { skills: { pdf: '1.0.0' }, packages: {} },
      },
    },
    frontend: {
      description: 'Frontend baseline',
      tags: { latest: '1.1.0' },
      versions: {
        '1.0.0': { skills: { pdf: '1.0.0' }, packages: { base: '2.0.0' } },
        '1.1.0': { skills: { pdf: '1.1.0' }, packages: {} },
      },
    },
  },
};

const skills: SkillFile = {
  schemaVersion: 2,
  skills: {
    pdf: {
      description: 'PDF toolkit',
      tags: { latest: '1.1.0' },
      versions: {
        '1.0.0': { integrity: 'sha512-a', fileCount: 1, size: 1, built: false },
        '1.1.0': { integrity: 'sha512-b', fileCount: 1, size: 1, built: false },
      },
    },
  },
};

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('expected a value');
  }
  return value;
}

function validDraft(): PackageDraft {
  return {
    ...createPackageDraft(packages),
    name: 'frontend',
    version: '1.2.0',
    skills: { pdf: '1.0.0' },
  };
}

describe('createPackageDraft', () => {
  it('starts in new-package mode with a suggested version and no dependencies', () => {
    expect(createPackageDraft(packages)).toEqual({
      nameMode: 'new',
      name: '',
      version: '1.0.0',
      description: '',
      skills: {},
      packages: {},
    });
  });
});

describe('copyPackageDraft', () => {
  it('copies description and dependencies and suggests the next patch version', () => {
    const draft = copyPackageDraft(packages, 'frontend', '1.0.0');

    expect(draft).toEqual({
      nameMode: 'existing',
      name: 'frontend',
      version: '1.1.1',
      description: 'Frontend baseline',
      skills: { pdf: '1.0.0' },
      packages: { base: '2.0.0' },
    });
  });

  it('falls back to empty values when the source version is unknown', () => {
    const draft = copyPackageDraft(packages, 'frontend', '9.9.9');

    expect(draft.skills).toEqual({});
    expect(draft.packages).toEqual({});
    expect(draft.version).toBe('1.1.1');
  });
});

describe('draft setters', () => {
  it('updates scalar fields immutably', () => {
    const draft = createPackageDraft(packages);

    expect(setDraftNameMode(draft, 'existing').nameMode).toBe('existing');
    expect(setDraftName(draft, 'frontend').name).toBe('frontend');
    expect(setDraftVersion(draft, '2.0.0').version).toBe('2.0.0');
    expect(setDraftDescription(draft, 'notes').description).toBe('notes');
    expect(draft.nameMode).toBe('new');
    expect(draft.name).toBe('');
  });
});

describe('dependency toggles', () => {
  it('adds the default exact version and removes on a second toggle', () => {
    const pdf = required(skillOptions(skills)[0]);
    const added = toggleDraftSkill(createPackageDraft(packages), pdf);

    expect(added.skills).toEqual({ pdf: '1.1.0' });
    expect(toggleDraftSkill(added, pdf).skills).toEqual({});
  });

  it('changes the pinned skill version', () => {
    const pdf = required(skillOptions(skills)[0]);
    const added = toggleDraftSkill(createPackageDraft(packages), pdf);

    expect(setDraftSkillVersion(added, 'pdf', '1.0.0').skills).toEqual({
      pdf: '1.0.0',
    });
  });

  it('toggles nested packages and changes their version', () => {
    const base = required(
      packageOptions(packages).find((option) => option.name === 'base'),
    );
    const added = toggleDraftPackage(createPackageDraft(packages), base);

    expect(added.packages).toEqual({ base: '2.0.0' });
    expect(
      setDraftPackageVersion(added, 'base', '2.0.1').packages,
    ).toEqual({ base: '2.0.1' });
    expect(toggleDraftPackage(added, base).packages).toEqual({});
  });
});

describe('packageDraftIssues', () => {
  it('accepts a complete draft', () => {
    expect(packageDraftIssues(validDraft(), packages)).toEqual([]);
  });

  it('reports a missing name', () => {
    expect(
      packageDraftIssues({ ...validDraft(), name: '   ' }, packages).map(
        (issue) => issue.code,
      ),
    ).toContain('name-missing');
  });

  it('reports a missing version', () => {
    expect(
      packageDraftIssues({ ...validDraft(), version: '' }, packages).map(
        (issue) => issue.code,
      ),
    ).toContain('version-missing');
  });

  it('reports a version that already exists for the package', () => {
    expect(
      packageDraftIssues({ ...validDraft(), version: '1.0.0' }, packages).map(
        (issue) => issue.code,
      ),
    ).toContain('version-taken');
  });

  it('reports an empty dependency set', () => {
    expect(
      packageDraftIssues(
        { ...validDraft(), skills: {}, packages: {} },
        packages,
      ).map((issue) => issue.code),
    ).toContain('no-dependencies');
  });
});

describe('toCreatePackageInput', () => {
  it('trims strings and omits a blank description', () => {
    expect(
      toCreatePackageInput(
        {
          ...validDraft(),
          name: ' frontend ',
          version: ' 1.2.0 ',
          description: '   ',
        },
        packages,
      ),
    ).toEqual({
      name: 'frontend',
      version: '1.2.0',
      description: undefined,
      skills: { pdf: '1.0.0' },
      packages: {},
    });
  });

  it('returns null when the name is missing', () => {
    expect(
      toCreatePackageInput({ ...validDraft(), name: '' }, packages),
    ).toBeNull();
  });

  it('returns null when no dependency is selected', () => {
    expect(
      toCreatePackageInput(
        { ...validDraft(), skills: {}, packages: {} },
        packages,
      ),
    ).toBeNull();
  });
});
