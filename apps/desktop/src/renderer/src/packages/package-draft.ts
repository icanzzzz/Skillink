import type { PackageFile } from '@skillink/shared';
import {
  defaultRequested,
  suggestVersionFor,
  type PackageOption,
  type SkillOption,
} from '../library.js';

/**
 * Local, renderer-only view of a package create request. Structurally equal to
 * `CreatePackageRequest` in `apps/desktop/src/ipc-schemas.ts`; the renderer
 * owns this shape so it never imports main-process modules.
 */
export interface CreatePackageFormInput {
  name: string;
  version: string;
  description?: string;
  skills: Record<string, string>;
  packages: Record<string, string>;
}

export interface PackageTagFormInput {
  name: string;
  version: string;
  tag: string;
}

export interface PackageVersionInput {
  name: string;
  version: string;
}

export type PackageNameMode = 'existing' | 'new';

export interface PackageDraft {
  nameMode: PackageNameMode;
  name: string;
  version: string;
  description: string;
  skills: Record<string, string>;
  packages: Record<string, string>;
}

export interface PackageDraftIssue {
  code:
    | 'name-missing'
    | 'version-missing'
    | 'version-taken'
    | 'no-dependencies';
}

function hasOwn(record: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function createPackageDraft(packages: PackageFile): PackageDraft {
  return {
    nameMode: 'new',
    name: '',
    version: suggestVersionFor(packages, ''),
    description: '',
    skills: {},
    packages: {},
  };
}

export function copyPackageDraft(
  packages: PackageFile,
  name: string,
  version: string,
): PackageDraft {
  const entry = packages.packages[name];
  const source = entry?.versions[version];

  return {
    nameMode: 'existing',
    name,
    version: suggestVersionFor(packages, name),
    description: entry?.description ?? '',
    skills: { ...(source?.skills ?? {}) },
    packages: { ...(source?.packages ?? {}) },
  };
}

export function setDraftNameMode(
  draft: PackageDraft,
  value: PackageNameMode,
): PackageDraft {
  return { ...draft, nameMode: value };
}

export function setDraftName(draft: PackageDraft, value: string): PackageDraft {
  return { ...draft, name: value };
}

export function setDraftVersion(
  draft: PackageDraft,
  value: string,
): PackageDraft {
  return { ...draft, version: value };
}

export function setDraftDescription(
  draft: PackageDraft,
  value: string,
): PackageDraft {
  return { ...draft, description: value };
}

export function toggleDraftSkill(
  draft: PackageDraft,
  option: SkillOption,
): PackageDraft {
  const skills = { ...draft.skills };
  if (hasOwn(skills, option.name)) {
    delete skills[option.name];
  } else {
    skills[option.name] = defaultRequested(option);
  }
  return { ...draft, skills };
}

export function setDraftSkillVersion(
  draft: PackageDraft,
  name: string,
  version: string,
): PackageDraft {
  return { ...draft, skills: { ...draft.skills, [name]: version } };
}

export function toggleDraftPackage(
  draft: PackageDraft,
  option: PackageOption,
): PackageDraft {
  const nested = { ...draft.packages };
  if (hasOwn(nested, option.name)) {
    delete nested[option.name];
  } else {
    nested[option.name] = defaultRequested(option);
  }
  return { ...draft, packages: nested };
}

export function setDraftPackageVersion(
  draft: PackageDraft,
  name: string,
  version: string,
): PackageDraft {
  return { ...draft, packages: { ...draft.packages, [name]: version } };
}

/**
 * Mirrors the core rejection rules that the renderer can check from its own
 * snapshot, so the UI never offers a create action that is guaranteed to fail.
 * The core schema remains the authority for everything else.
 */
export function packageDraftIssues(
  draft: PackageDraft,
  packages: PackageFile,
): PackageDraftIssue[] {
  const issues: PackageDraftIssue[] = [];
  const name = draft.name.trim();
  const version = draft.version.trim();

  if (name === '') {
    issues.push({ code: 'name-missing' });
  }
  if (version === '') {
    issues.push({ code: 'version-missing' });
  }
  if (name !== '' && version !== '') {
    const entry = packages.packages[name];
    if (entry !== undefined && entry.versions[version] !== undefined) {
      issues.push({ code: 'version-taken' });
    }
  }
  if (
    Object.keys(draft.skills).length === 0 &&
    Object.keys(draft.packages).length === 0
  ) {
    issues.push({ code: 'no-dependencies' });
  }

  return issues;
}

export function toCreatePackageInput(
  draft: PackageDraft,
  packages: PackageFile,
): CreatePackageFormInput | null {
  if (packageDraftIssues(draft, packages).length > 0) {
    return null;
  }

  const description = draft.description.trim();

  return {
    name: draft.name.trim(),
    version: draft.version.trim(),
    description: description === '' ? undefined : description,
    skills: { ...draft.skills },
    packages: { ...draft.packages },
  };
}
