import type {
  ImportSkillResult,
  SkillFile,
  SkillPackageCandidate,
} from '@skillink/shared';

export type SkillBatchStatus =
  | 'pending'
  | 'installing'
  | 'installed'
  | 'blocked'
  | 'error';

export interface SkillBatchItem {
  sourceDir: string;
  /** Name shown in the prefilled, editable field. Never empty after scanning. */
  name: string;
  /** Main version, with any build metadata (for example "+abc") stripped. */
  version: string;
  /** Default for the version field, equal to the prefilled main version. */
  defaultVersion: string;
  description?: string;
  directoryLinks: string[];
  status: SkillBatchStatus;
  error?: string;
  result?: ImportSkillResult;
}

function folderName(sourceDir: string): string {
  return sourceDir.split(/[\\/]+/u).filter(Boolean).at(-1) ?? sourceDir;
}

function versionMain(version: string | undefined): string {
  const trimmed = version?.trim() ?? '';
  return trimmed.split('+')[0] ?? trimmed;
}

export function toSkillBatchItem(
  candidate: SkillPackageCandidate,
): SkillBatchItem {
  const version = versionMain(candidate.version);
  const scannedName = candidate.name?.trim() ?? '';

  return {
    sourceDir: candidate.sourceDir,
    name: scannedName || folderName(candidate.sourceDir),
    version,
    defaultVersion: version,
    ...(candidate.description ? { description: candidate.description } : {}),
    directoryLinks: [...candidate.directoryLinks],
    status: 'pending',
  };
}

export function resolveSkillBatchName(
  item: Pick<SkillBatchItem, 'name'>,
): string {
  return item.name.trim();
}

export function resetBatchName(item: SkillBatchItem): SkillBatchItem {
  return { ...item, status: 'installed' };
}

export function isAlreadyInstalled(
  skills: SkillFile,
  name: string,
  version: string,
): boolean {
  const entry = skills.skills[name];
  if (!entry) {
    return false;
  }
  return Boolean(entry.versions[version]);
}
